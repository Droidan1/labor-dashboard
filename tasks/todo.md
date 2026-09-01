# Labor header shows a different week than the pane under it (2026-09-01)

**Reported:** "Can you fix the dates, they don't match up." Screenshot: Hours tab, header
week nav reads **Aug 30 – Sep 5**, the pane under it reads **Week of Aug 23 – Aug 29** with
Sun 23 → Sat 29 columns, and the chip beside the title reads **Trailing 4 wks · thru Aug 29**.

## What is actually wrong

The offset itself is intentional and consistent — `laborState.week` is the week being
**planned** (next full week), and both Budget vs Actual and Hours deliberately report the
week before it:

- `laborUpcomingSaturday()` → this week's Saturday **+ 7**  (the planned week)
- `laborActRange()`  → `laborState.week - 7`
- `laborHoursWeek()` → `laborState.week - 7`

Sun→Sat weeks check out (Aug 23 2026 is a Sunday, Aug 29 a Saturday), so the day columns
are right. The defect is that the **header chrome is hardcoded to the Planning week on all
three tabs**:

1. `initLabor()` sets `#labor-week-label` to `laborWeekLabel(laborState.week)` unconditionally,
   and `laborSetTab()` never touches it. On Budget vs Actual and Hours the nav therefore
   names a week neither pane is showing.
2. `#labor-fresh` ("Trailing 4 wks · thru …") is written only by `laborRender()` — Planning's
   renderer — but is never hidden, so Planning's *inputs* stay pinned over the other panes.

Same class as the 2026-07-03 lesson in `lessons.md`: a fixed period label left pointing at
the old period after the value under it moved.

## Plan

- [x] `laborReportedWeek()` — one definition of "the week Actual + Hours report", replacing
      the `- 7` duplicated in `laborActRange()` and `laborHoursWeek()`.
- [x] `laborHeaderWeek()` — the week the **active tab** renders: Planning → `laborState.week`,
      Actual/Hours → `laborReportedWeek()`.
- [x] `laborSyncWeekChrome()` — writes `#labor-week-label` from `laborHeaderWeek()` and hides
      `#labor-fresh` off Planning. Called from `initLabor()` and `laborSetTab()`.
- [x] Keep the arrows on `laborState.week`: a shift of ±7 moves both weeks together, so the
      label stays in step with whichever pane is open.
- [x] Prove it with a data-model reproduction (`scripts/test-labor-week-label.mjs`) rather
      than a screenshot — the page needs the remote worker + auth to render.

## Review

**Changed — `index.html`, 4 edits, no behaviour change to any figure:**

1. `laborReportedWeek()` — new. The single definition of the week Budget vs Actual and
   Hours report. `laborActRange()` and `laborHoursLoad()` now call it; the open-coded
   `- 7` is gone from both (`laborHoursWeek()` deleted as a duplicate of it).
2. `laborHeaderWeek()` — new. Planning → `laborState.week`; Actual/Hours → `laborReportedWeek()`.
3. `laborSyncWeekChrome()` — new. Writes `#labor-week-label` from `laborHeaderWeek()` and
   drops `sm:inline-flex` from `#labor-fresh` off Planning. Called from `laborSetTab()` (so
   it fires on every tab switch, which is what was missing) and, via it, from `initLabor()`.
   The hardcoded label write in `initLabor()` is removed — one writer now.
4. Corrected the Hours comment: it said the entered week "just RAN", but the arithmetic is
   the CURRENT week, which is what the Budget vs Actual comment eight lines up already says.

The arrows still move only `laborState.week`, so both weeks shift together and the label
cannot desync from the pane. No endpoint, query or figure changed — `laborActRange()`
returns the same `{from, to}` it did before.

**Verified:**
- `scripts/test-labor-week-label.mjs` — 32 assertions. Lifts the real functions out of
  `index.html` by name, so it fails if they are renamed or the offset is open-coded again.
- **Negative control:** a scratch copy with the old one-line header behaviour restored
  fails 9 of them and reproduces the screenshot verbatim —
  `expected "Aug 23 – Aug 29", got "Aug 30 – Sep 5"`.
- `npm test` — 2541 assertions across 51 suites, all pass (incl. `test-labor-plan`,
  `test-labor-endpoint`, `test-labour`).
- All 19,898 lines of inline JS in `index.html` parse (`node --check`).
- `npm run build` succeeds; `.sm\:inline-flex` is present in the compiled `dist/tailwind.css`,
  so the toggle acts on a real rule. No new class was introduced — the chip already shipped
  `hidden sm:inline-flex`, which is why it renders in the report.

**Left alone deliberately — worth a decision, not a silent change:**
Budget vs Actual and Hours anchor on the week *in progress*, not the last closed one. On a
Tuesday that means Hours opens on a week with five of seven columns blank and you press `‹`
once to reach the week you are actually keying from Paylocity. That anchoring is documented
as intentional ("Anchored on the CURRENT week"), so changing it is a product call, not a
bug fix. Flagged to Brian.
