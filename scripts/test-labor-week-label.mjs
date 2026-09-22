// Which week each Labor tab shows, and whether the header nav names it.
//
// Two things are pinned here.
//
// 1. The three tabs sit at FIXED offsets from the week being planned, and the
//    header nav names whichever one is open. It used to be written once, from
//    the planned week, on every tab — so Hours showed a nav reading
//    "Aug 30 - Sep 5" above a grid titled "Week of Aug 23 - Aug 29".
// 2. Hours opens on the last CLOSED week. Hours are keyed from Paylocity after
//    a week ends, so every column of that grid must already be in the past —
//    asserted here against a calendar, independently of how the offset table
//    computes it.
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

// Lift a top-level `function name(...) {...}` / `const NAME = {...}` by brace match.
function lift(decl, name) {
  const at = src.indexOf(decl === 'const' ? `const ${name} = {` : `function ${name}(`);
  if (at < 0) throw new Error(`index.html no longer defines ${name}`);
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1) + (decl === 'const' ? ';' : '');
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const FNS = ['laborUpcomingSaturday', 'laborWeekLabel', 'laborWeekFor',
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
  ${lift('const', 'LABOR_TAB_WEEKS_BACK')}
  ${FNS.map((n) => lift('function', n)).join('\n')}
  return { LABOR_TAB_WEEKS_BACK, ${FNS.join(', ')} };
`);
const L = build(laborState, (id) => dom[id]);

const SAT = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay() === 6;
const shift = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// ── The three tabs, one week apart, oldest first ──────────────────────────
// Screenshot state: planning Aug 30 – Sep 5.
laborState.week = '2026-09-05';
eq(L.laborWeekFor('plan'),  '2026-09-05', 'Planning renders the planned week');
eq(L.laborWeekFor('act'),   '2026-08-29', 'Budget vs Actual is one week back');
eq(L.laborWeekFor('hours'), '2026-08-22', 'Hours is two weeks back — the last CLOSED week');
eq(L.laborWeekLabel('2026-09-05'), 'Aug 30 – Sep 5', 'planned week label');
eq(L.laborWeekLabel('2026-08-29'), 'Aug 23 – Aug 29', 'reported week label');
eq(L.laborWeekLabel('2026-08-22'), 'Aug 16 – Aug 22', 'entered week label');
eq(JSON.stringify(L.LABOR_TAB_WEEKS_BACK), '{"plan":0,"act":-1,"hours":-2}', 'offset table');
ok(L.laborWeekFor('hours') < L.laborWeekFor('act') && L.laborWeekFor('act') < L.laborWeekFor('plan'),
   'the tabs stay strictly ordered hours < act < plan');
// An unknown tab must not silently land on some other week.
eq(L.laborWeekFor('nope'), L.laborWeekFor('plan'), 'unknown tab falls back to no offset');

// Sun→Sat, matching both sheets (tasks/labor-page.md).
for (const w of ['plan', 'act', 'hours']) {
  ok(SAT(L.laborWeekFor(w)), `${w} week ends on a Saturday`);
  eq(new Date(shift(L.laborWeekFor(w), -6) + 'T00:00:00Z').getUTCDay(), 0, `${w} week starts on a Sunday`);
}

// ── The header names whichever week the ACTIVE tab renders ────────────────
for (const [tab, want] of [['plan', 'Aug 30 – Sep 5'], ['act', 'Aug 23 – Aug 29'], ['hours', 'Aug 16 – Aug 22']]) {
  laborState.tab = tab;
  L.laborSyncWeekChrome();
  eq(dom['labor-week-label'].textContent, want, `header label on the ${tab} tab`);
  eq(dom['labor-week-label'].textContent, L.laborWeekLabel(L.laborWeekFor(tab)), `${tab} nav matches its own pane`);
}

// The original regression: on Hours the nav used to read the PLANNED week.
laborState.tab = 'hours';
L.laborSyncWeekChrome();
eq('Week of ' + L.laborWeekLabel(L.laborWeekFor('hours')),          // laborHoursRender's title
   'Week of ' + dom['labor-week-label'].textContent, 'Hours pane title matches the nav');
ok(dom['labor-week-label'].textContent !== L.laborWeekLabel(laborState.week),
   'Hours nav no longer shows the planned week');

// Budget vs Actual still ends on the week in progress — moving Hours must not
// have dragged it along.
laborState.tab = 'act';
L.laborSyncWeekChrome();
eq(L.laborActRange().to, '2026-08-29', 'Budget vs Actual still anchors on the week in progress');
eq(L.laborActRange().to, L.laborWeekFor('act'), 'Budget vs Actual fetches the week it labels');
eq('Week of ' + L.laborWeekLabel(L.laborActRange().to), 'Week of ' + dom['labor-week-label'].textContent,
   'Budget vs Actual pane matches the nav');
laborState.grain = 'd';
eq(L.laborActRange().from, '2026-08-16', 'daily grain still spans the 14 days ending there');
laborState.grain = 'w';
eq(L.laborActRange().from, '2026-07-05', 'weekly grain still spans the 8 weeks ending there');

// ── Hours really does open on the last CLOSED week, any day of the week ───
// Checked against the calendar, not against the offset table: the most recent
// Saturday STRICTLY before today, since a week is not keyable until it ends.
for (const today of ['2026-08-23', '2026-08-25', '2026-08-28', '2026-08-29', '2026-08-30', '2026-09-01', '2026-09-05']) {
  laborState.week = L.laborUpcomingSaturday(today);
  const wkEnd = L.laborWeekFor('hours');                            // what laborHoursLoad fetches
  let want = shift(today, -1);
  while (!SAT(want)) want = shift(want, -1);
  eq(wkEnd, want, `Hours opens on the last closed week from ${today}`);
  ok(wkEnd < today, `every Hours column is in the past from ${today}`);
  // …and it is the LAST such week, not an older one.
  ok(shift(wkEnd, 7) >= today, `Hours is not further back than it needs to be from ${today}`);
  // Planning stays the upcoming week — a schedule is written before it runs.
  ok(L.laborWeekFor('plan') > today, `Planning is still ahead of ${today}`);
}

// ── The arrows move all three together ────────────────────────────────────
// laborShiftWeek only ever touches laborState.week, so the offsets hold and the
// label cannot desync from the pane.
for (const n of [-2, -1, 1, 2]) {
  laborState.week = shift('2026-09-05', n * 7);
  for (const tab of ['plan', 'act', 'hours']) {
    laborState.tab = tab;
    L.laborSyncWeekChrome();
    const base = { plan: '2026-09-05', act: '2026-08-29', hours: '2026-08-22' }[tab];
    eq(dom['labor-week-label'].textContent, L.laborWeekLabel(shift(base, n * 7)), `${tab} tab after shift ${n}`);
  }
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

// Nothing else may write the nav label, and nothing may re-open-code an offset:
// one writer and one table are what keep the nav and the panes in step.
eq((src.match(/labor-week-label/g) || []).length, 2,
   'labor-week-label appears only in the markup and laborSyncWeekChrome');
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
eq((code.match(/LABOR_TAB_WEEKS_BACK/g) || []).length, 2,
   'LABOR_TAB_WEEKS_BACK is declared once and read once, by laborWeekFor');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
