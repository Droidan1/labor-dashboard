// Invariant: nothing reads `aAuction` off a row that might be TODAY's.
//
// `loadStoreFromD1` nulls `aAuction` on today's row and keeps the value in
// `auctionRaw`. The nulling exists to stop a double-count against live Clover —
// and auction is NOT a Clover channel, so live never supplies it and
// `auctionRaw` is the only field where today's auction survives. `rowAuction()`
// encodes that preference; every read of a possibly-today row must go through it.
//
// Six call sites got this wrong at once, each having already identified the row
// as today's: the pace alerts, the All Stores headline, the combined budget
// card's month-to-date, the store card's Net and Auction tile, the store-detail
// hero chip, and the Hourly Snapshot. All six read null and silently dropped
// today's auction. One of them even carried a comment saying "today's stored
// auction is nulled … so this is the only source" directly above a read of the
// nulled field.
//
// This is a pattern bug, not an arithmetic slip, so the guard is a pattern:
// every direct `.aAuction` read must be one of the listed safe shapes, each
// with a reason. A new `todayRow.aAuction` fails here instead of shipping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const lines = html.split('\n');

console.log('\n── Today-row auction reads ──');

// Direct `.aAuction` reads that are safe, and why. A read not matching any of
// these must go through rowAuction().
const ALLOWED = [
  ['r?.auctionRaw ?? r?.aAuction',
   "rowAuction's own fallback — this is the helper being defined"],
  ['if (r.aAuction != null) aAuction = (aAuction || 0) + r.aAuction;',
   'sumRows: today is excluded by design so live sales can be added on top; ' +
   'reading auctionRaw here would double-count'],
  ['if (r.aAuction != null) todayAuction += r.aAuction;',
   'historical branch — histSkipToday drops today\'s row whenever the selection includes it'],
  ['posSales + (r.aAuction ?? 0)',
   'buildAllStoresWeeklyTable: documented "today keeps its live-POS behavior"'],
  ['mtdActual += (r.aTotal || 0) + (r.aAuction || 0);',
   'month-to-date loop explicitly `continue`s on d >= todayStr'],
  ['m.aAuction',
   'a sumRows RESULT, not a row — today was already excluded upstream'],
  ['wk.aAuction',
   'a sumRows RESULT, not a row'],
];

// Strip line comments so prose mentioning m.aAuction is not treated as a read.
const codeOf = (line) => {
  const i = line.indexOf('//');
  return i === -1 ? line : line.slice(0, i);
};

const offenders = [];
lines.forEach((line, i) => {
  const code = codeOf(line);
  if (!code.includes('.aAuction')) return;
  if (ALLOWED.some(([snippet]) => code.includes(snippet))) return;
  offenders.push(`index.html:${i + 1}  ${code.trim()}`);
});

ok(offenders.length === 0,
  'every direct .aAuction read is a known-safe shape; use rowAuction() for a row that ' +
  `could be today's, or add a justified entry here.\n         Unlisted:\n         ` +
  offenders.join('\n         '));

// Each allowlist entry must still correspond to real code. An entry that stops
// matching is a stale justification, and a stale allowlist is how the next one
// slips through.
for (const [snippet, why] of ALLOWED) {
  ok(lines.some(l => codeOf(l).includes(snippet)),
    `allowlisted read is still present — ${snippet.slice(0, 40)}… (${why.slice(0, 48)}…)`);
}

// The six sites this fixed must keep going through the helper. Anchored on the
// receiver, which is what identifies a today-row read.
const MUST_USE_HELPER = [
  ['rowAuction(todayRow) ?? 0', 'pace / milestone alerts'],
  ['const todayRowAuction = rowAuction(todayRow);', 'All Stores headline, live branch'],
  ['const rAuction = rowAuction(r);', 'combined budget card, month to date'],
  ['cardShowLive ? rowAuction(getTodayRow(m.store)) : null', "store card Net + Auction tile"],
  ['isCurrentWeek ? rowAuction(getTodayRow(storeName)) : null', 'store-detail hero chip + week total'],
  ['const auction = rowAuction(today) || 0;', 'Hourly Snapshot'],
];
for (const [snippet, surface] of MUST_USE_HELPER) {
  ok(html.includes(snippet), `${surface} reads today's auction through rowAuction()`);
}

// And the helper itself must still prefer auctionRaw, or all of the above is
// routed through something that reproduces the bug.
const helper = html.slice(html.indexOf('  function rowAuction(r) {'));
ok(/return r\?\.auctionRaw \?\? r\?\.aAuction \?\? null;/.test(helper.slice(0, 200)),
  'rowAuction still prefers auctionRaw over the nulled aAuction');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
