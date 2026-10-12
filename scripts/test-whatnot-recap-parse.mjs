// The Whatnot recap parser in scripts/whatnot-recap-ingest.gs, run in a VM
// exactly as Apps Script would load it (the file is not modified or sliced).
//
// The fixtures copy the REAL recap email's format byte for byte where it
// matters: the plain-text body hard-wraps in the middle of a show line, a
// forward adds a header block above it, amounts appear both with and without
// thousands commas, and the subject uses an en dash. The figures and names are
// made up: this repo is public.
//
// What this is defending: a recap is posted only when its show lines add up to
// its own subject line. A wrong Whatnot figure in the Executive Summary is
// worse than a missing one, so every malformed case must THROW, never return
// a partial day.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const throwsLike = (fn, re, m) => { try { fn(); ok(false, m + ' (did not throw)'); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };

const src = fs.readFileSync(path.join(repo, 'scripts/whatnot-recap-ingest.gs'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__t = { parseRecap_, buildPayload_ };', sandbox);
const { parseRecap_, buildPayload_ } = sandbox.__t;

const SENT = new Date('2026-10-10T08:59:00Z');
const PDF = ['BL-Live-Recap-2026-10-09.pdf'];
const SUBJECT = 'Bargain Lane Live recap – Fri 10/9: $4,321 on 3 shows';
const BODY = `---------- Forwarded message ---------
From: Recap Tool <tool@example.com>
Date: Sat, Oct 10, 2026 at 4:59 AM
Subject: Bargain Lane Live recap – Fri 10/9: $4,321 on 3 shows
To: <a@example.com>, <b@example.com>


Hi team,

Here's the Whatnot recap for Friday, 10/9. The PDF is attached.

- Fort Wayne, 9:31 AM, "$1 Starts: Women's Fashion Finds": $500 in sales,
100 items, 40 shipments, 5 new buyers
- Fort Wayne, 12:00 PM, "$5 Starts: Bags on Bags": $1521 in sales, 150
items, 60 shipments, 10 new buyers
- Battle Creek, 3:59 PM, "$10 Starts: Coat Finds": $2,300 in sales, 120
items, 50 shipments, 12 new buyers
- October to date: $20,000 from 15 shows (Fort Wayne $8,000, Battle Creek
$12,000)

Sales are gross from Whatnot's end-of-show summaries, before fees and
refunds.
`;

// ── A forwarded recap, wrapped mid-line ─────────────────────────────────────
{
  const r = parseRecap_('Fwd: ' + SUBJECT, BODY, PDF, SENT);
  eq(r.date, '2026-10-09', 'date from the subject, confirmed by the PDF name');
  eq(r.shows.length, 3, 'three show lines read across the hard wraps');
  eq(r.shows.map(s => s.store), ['BL1', 'BL1', 'BL14'], 'Fort Wayne → Coliseum (BL1), Battle Creek → BL14');
  eq(r.shows.map(s => s.sales), [500, 1521, 2300], 'amounts with and without thousands commas');
  eq(r.shows[0].title, "$1 Starts: Women's Fashion Finds", 'a title containing $ and an apostrophe');
  eq(r.mtd, { BL1: 8000, BL14: 12000 }, 'month-to-date per store, wrapped across lines');
  const p = buildPayload_(r);
  eq(p.channel, 'whatnot', 'posts to the whatnot channel');
  eq(p.rows.map(x => [x.store, x.date, x.total, x.count]), [['BL1', '2026-10-09', 2021, 2], ['BL14', '2026-10-09', 2300, 1]], 'one row per store: gross sales and show count');
  eq(p.rows[0].meta, { items: 250, shipments: 100, new_buyers: 15 }, 'items, shipments and new buyers summed per store');
  eq(p.reconcile, { through: '2026-10-09', totals: { BL1: 8000, BL14: 12000 } }, 'the month-to-date rides along for the worker to check');
}

// ── The original (not forwarded), and a reply quoting it ────────────────────
{
  const r = parseRecap_(SUBJECT, BODY.split('\n').slice(6).join('\n'), [], SENT);
  eq(r.date, '2026-10-09', 'no PDF: year from the sent date');
  eq(r.shows.length, 3, 'same shows without the forward header');
  eq(parseRecap_('Re: something else', BODY, PDF, SENT), null, 'a non-recap subject is ignored, not an error');
}

// ── A day with no shows still records both stores at $0 ─────────────────────
{
  const r = parseRecap_('Bargain Lane Live recap – Sun 10/11: $0 on 0 shows',
    'No shows today.\n- October to date: $20,000 from 15 shows (Fort Wayne $8,000, Battle Creek $12,000)', [], SENT);
  const p = buildPayload_(r);
  eq(p.rows.map(x => [x.store, x.total, x.count]), [['BL1', 0, 0], ['BL14', 0, 0]], 'a 0-show recap posts $0 for every store');
  const first = parseRecap_('Bargain Lane Live recap – Thu 10/1: $900 on 1 show',
    '- Battle Creek, 4:00 PM, "Openers": $900 in sales\n- October to date: $900 from 1 show (Battle Creek $900)', [], SENT);
  eq(first.mtd, { BL1: 0, BL14: 900 }, 'a store missing from the month-to-date line is checked as $0');
}

// ── A December recap read in January ────────────────────────────────────────
eq(parseRecap_('Bargain Lane Live recap – Thu 12/31: $0 on 0 shows', '', [], new Date('2027-01-02T10:00:00Z')).date,
  '2026-12-31', 'year rolls back for a December recap sent in January');

// ── Everything that does not add up THROWS ──────────────────────────────────
throwsLike(() => parseRecap_(SUBJECT.replace('$4,321', '$4,999'), BODY, PDF, SENT), /subject says 3 shows, \$4999/, 'show lines that do not sum to the subject total');
throwsLike(() => parseRecap_(SUBJECT.replace('on 3 shows', 'on 4 shows'), BODY, PDF, SENT), /read 3 shows/, 'a show line the parser could not read');
throwsLike(() => parseRecap_(SUBJECT, BODY.replace('Battle Creek, 3:59', 'Dupont, 3:59'), PDF, SENT), /unknown location "Dupont"/, 'a location with no store mapping');
throwsLike(() => parseRecap_(SUBJECT, BODY, ['BL-Live-Recap-2026-10-08.pdf'], SENT), /PDF is for 2026-10-08/, 'subject date and PDF date disagree');
throwsLike(() => parseRecap_(SUBJECT, BODY.replace('Battle Creek\n$12,000', 'Holland $12,000'), PDF, SENT), /unknown location "Holland" in the month-to-date/, 'an unknown location in the month-to-date line');
// A month-to-date email laid out like a daily recap would sum to its own subject
// and book every show onto ONE day. Show lines carry no date, but a day's shows
// run in time order; times that go backwards mean more than one day.
throwsLike(() => parseRecap_('Bargain Lane Live recap \u2013 Fri 10/9: $3,000 on 3 shows',
  '- Fort Wayne, 9:31 AM, "A": $1000 in sales\n- Battle Creek, 4:00 PM, "B": $1000 in sales\n- Fort Wayne, 9:30 AM, "C": $1000 in sales', [], SENT),
  /not in time order/, 'show times that go backwards (more than one day) are refused');
eq(parseRecap_('Bargain Lane Live recap \u2013 Fri 10/9: $2,000 on 2 shows',
  '- Fort Wayne, 12:00 PM, "A": $1000 in sales\n- Battle Creek, 12:00 PM, "B": $1000 in sales', [], SENT).shows.length, 2,
  'two shows at the same time are fine');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
