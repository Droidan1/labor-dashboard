// Labor header week nav vs. the pane under it.
//
// The bug: the header nav was hardcoded to the week being PLANNED on all three
// tabs, while Budget vs Actual and Hours both render the week before it. On
// 2026-08-25 the nav read "Aug 30 – Sep 5" over an Hours grid titled "Week of
// Aug 23 – Aug 29" — two different weeks, one screen.
//
// The offset is deliberate and stays: Planning forecasts the upcoming week,
// the other two report the one that closed. What is asserted here is that the
// LABEL follows the pane. Same class as the 2026-07-03 lesson in lessons.md —
// a fixed period label left pointing at the old period.
//
// The page needs the remote worker + auth to render, so a screenshot proves
// nothing; the real functions are lifted out of index.html by name (so this
// cannot drift from what ships) and driven directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const src = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

// Lift a top-level `function name(...) { ... }` out of index.html by brace match.
function lift(name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`index.html no longer defines ${name}()`);
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

const NAMES = ['laborUpcomingSaturday', 'laborWeekLabel', 'laborReportedWeek',
               'laborHeaderWeek', 'laborActRange', 'laborSyncWeekChrome'];

// One stub DOM node per id the chrome touches, so classList.toggle is real.
const node = () => {
  const cls = new Set();
  return {
    textContent: '—',
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; },
    },
  };
};
const dom = { 'labor-week-label': node(), 'labor-fresh': node() };
const laborState = { week: null, store: 'all', tab: 'plan', grain: 'w' };

const build = new Function('laborState', 'el', `
  ${NAMES.map(lift).join('\n')}
  return { ${NAMES.join(', ')} };
`);
const L = build(laborState, (id) => dom[id]);

// ── The reported week is the one before the planned week ──────────────────
// Screenshot state: planning Aug 30 – Sep 5, so Actual + Hours report Aug 23–29.
laborState.week = '2026-09-05';
eq(L.laborWeekLabel(laborState.week), 'Aug 30 – Sep 5', 'planned week label');
eq(L.laborReportedWeek(), '2026-08-29', 'reported week is planned − 7');
eq(L.laborWeekLabel(L.laborReportedWeek()), 'Aug 23 – Aug 29', 'reported week label');

// Sun→Sat, matching both sheets (tasks/labor-page.md).
const start = new Date('2026-08-29T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 6);
eq(start.toISOString().slice(0, 10), '2026-08-23', 'week starts Sunday');
eq(new Date('2026-08-23T00:00:00Z').getUTCDay(), 0, 'Aug 23 2026 is a Sunday');
eq(new Date('2026-08-29T00:00:00Z').getUTCDay(), 6, 'Aug 29 2026 is a Saturday');

// ── The header names whichever week the ACTIVE tab renders ────────────────
for (const [tab, want] of [['plan', 'Aug 30 – Sep 5'], ['act', 'Aug 23 – Aug 29'], ['hours', 'Aug 23 – Aug 29']]) {
  laborState.tab = tab;
  L.laborSyncWeekChrome();
  eq(dom['labor-week-label'].textContent, want, `header label on the ${tab} tab`);
}

// The regression itself: on Hours the header used to read the PLANNED week
// while the pane read the reported one. Those must now be the same string.
laborState.tab = 'hours';
L.laborSyncWeekChrome();
const paneTitle = 'Week of ' + L.laborWeekLabel(L.laborReportedWeek());   // laborHoursRender
eq(paneTitle, 'Week of ' + dom['labor-week-label'].textContent, 'Hours pane title matches the nav');
ok(dom['labor-week-label'].textContent !== L.laborWeekLabel(laborState.week),
   'Hours nav no longer shows the planned week');

// Budget vs Actual ends on that same week — the two report tabs agree.
laborState.tab = 'act';
L.laborSyncWeekChrome();
eq(L.laborActRange().to, L.laborReportedWeek(), 'Budget vs Actual ends on the reported week');
eq('Week of ' + L.laborWeekLabel(L.laborActRange().to), 'Week of ' + dom['labor-week-label'].textContent,
   'Budget vs Actual pane matches the nav');
// Daily grain spans 14 days ending there; the range must not move with the tab.
eq(L.laborActRange().to, '2026-08-29', 'reported week unchanged by tab switching');

// ── The arrows move both weeks together ───────────────────────────────────
// laborShiftWeek only ever touches laborState.week, so the label and the pane
// stay in step — a shift can never desync them.
for (const [n, plan, rep] of [[-1, 'Aug 23 – Aug 29', 'Aug 16 – Aug 22'], [1, 'Sep 6 – Sep 12', 'Aug 30 – Sep 5']]) {
  const d = new Date('2026-09-05T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n * 7);
  laborState.week = d.toISOString().slice(0, 10);
  laborState.tab = 'plan'; L.laborSyncWeekChrome();
  eq(dom['labor-week-label'].textContent, plan, `plan tab after shift ${n}`);
  laborState.tab = 'hours'; L.laborSyncWeekChrome();
  eq(dom['labor-week-label'].textContent, rep, `hours tab after shift ${n}`);
}

// ── The trailing-weeks chip is Planning's, and only Planning's ────────────
// It describes the four weeks the RECOMMENDATION consumed, so it is a lie over
// the other two panes. `hidden sm:inline-flex` is its visible state, so the
// sm: variant is what has to come off — adding `hidden` would do nothing at sm+.
for (const [tab, shown] of [['plan', true], ['act', false], ['hours', false]]) {
  laborState.tab = tab;
  L.laborSyncWeekChrome();
  eq(dom['labor-fresh'].classList.contains('sm:inline-flex'), shown, `trailing-weeks chip on ${tab}`);
}
ok(/id="labor-fresh"[^>]*class="[^"]*\bhidden sm:inline-flex\b/.test(src),
   'labor-fresh still ships `hidden sm:inline-flex` for the toggle to act on');

// ── Planning really is the UPCOMING week, on every weekday ────────────────
// A schedule is written before the week it covers, so from any day of a week
// the planned week is the NEXT one and the reported week is the current one.
for (const [today, planEnd] of [
  ['2026-08-23', '2026-09-05'],   // Sunday
  ['2026-08-25', '2026-09-05'],   // Tuesday — the screenshot's state
  ['2026-08-29', '2026-09-05'],   // Saturday, the last day of the week
  ['2026-08-30', '2026-09-12'],   // next Sunday rolls it forward
]) {
  eq(L.laborUpcomingSaturday(today), planEnd, `planned week from ${today}`);
  laborState.week = L.laborUpcomingSaturday(today);
  const rep = new Date(planEnd + 'T00:00:00Z'); rep.setUTCDate(rep.getUTCDate() - 7);
  eq(L.laborReportedWeek(), rep.toISOString().slice(0, 10), `reported week from ${today}`);
}

// Nothing else may write the nav label — one writer is what keeps it honest.
const writers = (src.match(/labor-week-label/g) || []).length;
eq(writers, 2, 'labor-week-label appears only in the markup and laborSyncWeekChrome');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 1 && 0 : 1);
