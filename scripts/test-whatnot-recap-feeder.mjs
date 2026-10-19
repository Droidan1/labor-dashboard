// The Whatnot recap feeder's RUN loop (runDaily / backfill / preview), not just
// its parser: scripts/whatnot-recap-ingest.gs loaded unmodified in a VM with
// fake GmailApp, PropertiesService, UrlFetchApp and MailApp.
//
// What this is defending (found by review before the first run, 2026-10-12):
//   • an original and a corrected re-send for the same day: the NEWER one must
//     be what stays stored, on every later run (it used to post the older one
//     on top, one trigger later);
//   • the bookkeeping property must stay small (Apps Script caps a property at
//     9 KB; a map of every message ever seen crossed it within months);
//   • a reply is not a recap, and a recap whose subject no longer parses must
//     ALERT, not vanish silently;
//   • preview() posts nothing.
// And the recap's PDF upload for the Executive Summary (2026-10-19): sent once per
// copy, retried on the next run when it fails, never re-posting the day's sales.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const src = fs.readFileSync(path.join(repo, 'scripts/whatnot-recap-ingest.gs'), 'utf8');
const SENDER = 'Recap Sender <bgeorges@retjg.com>';

let nextId = 1;
function msg({ subject, body, sent, from = SENDER, pdf = [] }) {
  const id = 'm' + nextId++;
  return {
    getId: () => id, getSubject: () => subject, getPlainBody: () => body, getFrom: () => from,
    getDate: () => new Date(sent),
    getAttachments: () => pdf.map(n => ({ getName: () => n, getBytes: () => Array.from(Buffer.from('%PDF-' + n)) })),
  };
}
const recap = (md, total, lines, sent, extra = {}) => msg({
  subject: `Bargain Lane Live recap – Fri ${md}: $${total} on ${lines.length} show${lines.length === 1 ? '' : 's'}`,
  body: lines.map(([loc, time, amt]) => `- ${loc}, ${time}, "Show": $${amt} in sales, 10 items, 5 shipments, 1 new buyers`).join('\n'),
  sent, ...extra,
});

function rig(inbox, props = {}, { pdfCode = () => 200, pdfThrows = () => false } = {}) {
  const posts = [], pdfs = [], mails = [], logs = [];
  const store = { SNAPSHOT_SECRET: 's3cret', ...props };
  const sb = {
    GmailApp: { search: (q, start) => (start === 0 ? inbox.map(m => ({ getMessages: () => [m] })) : []) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large'); store[k] = String(v); },
    }) },
    UrlFetchApp: { fetch: (u, o) => {
      if (u.includes('action=live-recap-pdf')) {
        if (pdfThrows(pdfs.length)) { pdfs.push({ url: u, code: 'threw' }); throw new Error('Address unavailable: ' + u); }
        const code = pdfCode(pdfs.length);
        pdfs.push({ url: u, type: o.contentType, secret: o.headers['X-Snapshot-Secret'], body: Buffer.from(o.payload).toString(), code });
        return { getResponseCode: () => code, getContentText: () => (code === 200 ? '{"ok":true}' : '{"error":"x"}') };
      }
      posts.push(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    } },
    MailApp: { sendEmail: (to, subject) => mails.push(subject) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    Logger: { log: s => logs.push(String(s)) },
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return { sb, posts, pdfs, mails, logs, store };
}
const totalsOf = (posts) => posts.map(p => [p.rows[0].date, p.rows.map(r => r.total)]);

// ── 1. Original + corrected re-send: the newer one wins, every run ──────────
{
  const orig = recap('10/9', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z');
  const fixd = recap('10/9', '3,100', [['Fort Wayne', '9:30 AM', '3100']], '2026-10-10T11:00:00Z');
  const r = rig([orig, fixd]);
  vm.runInContext('runDaily()', r.sb);
  vm.runInContext('runDaily()', r.sb);
  eq(totalsOf(r.posts), [['2026-10-09', [3100, 0]]], 'only the corrected re-send is posted, and a second run posts nothing');
}
{
  // The correction arrives after the original was already posted.
  const orig = recap('10/9', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z');
  const inbox = [orig];
  const r = rig(inbox);
  vm.runInContext('runDaily()', r.sb);
  inbox.push(recap('10/9', '3,100', [['Fort Wayne', '9:30 AM', '3100']], '2026-10-10T15:00:00Z'));
  vm.runInContext('runDaily()', r.sb);
  // And a late copy of the ORIGINAL (a forward of it) must not undo the correction.
  inbox.push(recap('10/9', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z', { subject: 'Fwd: Bargain Lane Live recap – Fri 10/9: $3,000 on 1 show' }));
  vm.runInContext('runDaily()', r.sb);
  eq(totalsOf(r.posts), [['2026-10-09', [3000, 0]], ['2026-10-09', [3100, 0]]], 'a later correction is posted; a late copy of the original is not');
}

// ── 2. Bookkeeping stays bounded ────────────────────────────────────────────
{
  const old = {};
  for (let i = 0; i < 400; i++) old[`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}x${i}`] = 1;
  const r = rig([recap('10/9', '50', [['Battle Creek', '4:00 PM', '50']], '2026-10-10T09:00:00Z')], { postedRecaps: JSON.stringify(old) });
  vm.runInContext('runDaily()', r.sb);
  eq(r.posts.length, 1, 'posts despite a large stale bookkeeping map');
  eq(Object.keys(JSON.parse(r.store.postedRecaps)), ['2026-10-09'], 'entries older than the retention window are pruned');
}

// ── 3. Replies are not recaps; an unreadable recap alerts once ──────────────
{
  const reply = msg({ subject: 'Re: Bargain Lane Live recap – Fri 10/9: $3,000 on 1 show', body: 'Thanks!', sent: '2026-10-10T12:00:00Z' });
  const other = msg({ subject: 'Bargain Lane Live recap – Fri 10/9: $3,000 on 1 show', body: '- Fort Wayne, 9:30 AM, "S": $3000 in sales', sent: '2026-10-10T13:00:00Z', from: 'Someone <x@example.com>' });
  const changed = msg({ subject: 'Bargain Lane Live recap for Thursday, October 8', body: '- Fort Wayne, 9:30 AM, "S": $10 in sales', sent: '2026-10-09T09:00:00Z' });
  const r = rig([reply, other, changed]);
  vm.runInContext('runDaily()', r.sb);
  vm.runInContext('runDaily()', r.sb);
  eq(r.posts.length, 0, 'nothing posted from a reply, a stranger, or an unreadable subject');
  eq(r.mails.length, 1, 'the unreadable recap alerts exactly once across runs');
  ok(r.mails[0] && r.mails[0].includes('October 8'), 'the alert names the email it could not read');
}

// ── 4. preview() reads everything and posts nothing ─────────────────────────
{
  const r = rig([
    recap('10/8', '1,872', [['Battle Creek', '4:00 PM', '1872']], '2026-10-09T09:00:00Z'),
    recap('10/9', '6,418', [['Fort Wayne', '9:31 AM', '840'], ['Fort Wayne', '12:00 PM', '2528'], ['Battle Creek', '3:59 PM', '3050']], '2026-10-10T09:00:00Z'),
  ]);
  vm.runInContext('preview()', r.sb);
  eq(r.posts.length, 0, 'preview posts nothing');
  eq(r.store.postedRecaps, undefined, 'preview records nothing as posted');
  ok(r.logs.some(l => l.startsWith('2026-10-08') && l.includes('BL14 $1872')), 'preview logs each day per store');
  ok(r.logs.some(l => l.startsWith('2026-10-09') && l.includes('BL1 $3368') && l.includes('BL14 $3050')), 'preview sums a store\'s shows');
}

// ── 5. The schedule: every 10 minutes, not fixed hours ───────────────────────
// 2026-10-13: the 6/7 AM hour triggers never fired (an hour trigger runs in the
// PROJECT's time zone, and fires anywhere inside its hour), and the recap reached
// the inbox at 7:03, so the 8 AM email nearly went out without Monday's Whatnot.
// A 10-minute cadence has no time zone and picks a recap up within 10 minutes.
{
  const r = rig([]);
  const made = [], deleted = [];
  const builder = (fn) => { const t = { fn }; return {
    timeBased: () => ({
      everyMinutes: (n) => ({ create: () => { t.minutes = n; made.push(t); } }),
      everyDays: () => ({ atHour: (h) => ({ create: () => { t.hour = h; made.push(t); }, inTimezone: () => ({ create: () => { t.hour = h; made.push(t); } }) }) }),
    }) }; };
  r.sb.ScriptApp = {
    getProjectTriggers: () => [{ getHandlerFunction: () => 'runDaily', id: 'old6' }, { getHandlerFunction: () => 'runDaily', id: 'old7' }, { getHandlerFunction: () => 'other', id: 'keep' }],
    deleteTrigger: (t) => deleted.push(t.id),
    newTrigger: builder,
  };
  vm.runInContext('installTrigger()', r.sb);
  eq(deleted, ['old6', 'old7'], 'replaces every old runDaily trigger, and only those');
  eq(made.map(t => [t.fn, t.minutes, t.hour]), [['runDaily', 10, undefined]], 'one trigger: runDaily every 10 minutes, no fixed hour');
}

// ── 6. The PDF goes to the worker for the Executive Summary ─────────────────
const withPdf = (md, date, total, lines, sent, extra = {}) =>
  recap(md, total, lines, sent, { pdf: [`BL-Live-Recap-${date}.pdf`], ...extra });
{
  const r = rig([withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z')]);
  vm.runInContext('runDaily()', r.sb);
  eq(r.posts.length, 1, 'the day\'s sales are posted');
  eq(r.pdfs.map(p => [p.url, p.type, p.secret, p.body]),
     [['https://api.retjghub.com/?action=live-recap-pdf&date=2026-10-09', 'application/pdf', 's3cret', '%PDF-BL-Live-Recap-2026-10-09.pdf']],
     'its PDF is uploaded for that date, as a PDF, with the secret');
  vm.runInContext('runDaily()', r.sb);
  eq([r.posts.length, r.pdfs.length], [1, 1], 'a second run uploads nothing again');
}
{
  // The upload fails once. The sales must not be re-posted, and the PDF must be retried.
  const r = rig([withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z')], {}, { pdfCode: n => (n === 0 ? 500 : 200) });
  let threw = null;
  try { vm.runInContext('runDaily()', r.sb); } catch (e) { threw = e.message; }
  ok(threw && /PDF/.test(threw), `a failed upload fails the run, so Apps Script reports it (${threw})`);
  eq(r.posts.length, 1, '...after the sales were posted and recorded');
  vm.runInContext('runDaily()', r.sb);
  eq([r.posts.length, r.pdfs.length, r.pdfs[1] && r.pdfs[1].code], [1, 2, 200], 'the next run retries the PDF only');
}
{
  // A network error (not an HTTP status) on one day's PDF must not stop the next day's sales.
  const r = rig([
    withPdf('10/8', '2026-10-08', '1,000', [['Battle Creek', '4:00 PM', '1000']], '2026-10-09T09:00:00Z'),
    withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z'),
  ], {}, { pdfThrows: n => n === 0 });
  let threw = null;
  try { vm.runInContext('runDaily()', r.sb); } catch (e) { threw = e.message; }
  eq(totalsOf(r.posts).map(p => p[0]), ['2026-10-08', '2026-10-09'], 'a PDF fetch that throws does not stop the next day\'s sales');
  ok(threw && threw.includes('2026-10-08') && !threw.includes('2026-10-09'), `the run reports only the failed day (${threw})`);
  vm.runInContext('runDaily()', r.sb);
  eq([r.posts.length, r.pdfs.filter(p => p.code === 200).map(p => p.url.slice(-10))], [2, ['2026-10-09', '2026-10-08']], 'the next run retries that PDF only');
}
{
  // 413 (too large) can never succeed: reported once, not retried every 10 minutes.
  const r = rig([withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z')], {}, { pdfCode: () => 413 });
  let threw = null;
  try { vm.runInContext('runDaily()', r.sb); } catch (e) { threw = e.message; }
  ok(threw && threw.includes('413'), 'a 413 is reported');
  vm.runInContext('runDaily()', r.sb);
  eq(r.pdfs.length, 1, '...once: the next run does not retry it');
}
{
  const r = rig([recap('10/9', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z', { pdf: ['Fwd BL-Live-Recap-2026-10-09.pdf', 'BL-Live-Recap-2026-10-08.pdf'] })]);
  vm.runInContext('runDaily()', r.sb);
  eq(r.pdfs.map(p => p.url.slice(-10)), ['2026-10-09'], 'the PDF is matched by its date as the parser reads it, not its exact name');
}
{
  // A corrected re-send carries its own PDF: the newer copy replaces the stored one.
  const inbox = [withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z')];
  const r = rig(inbox);
  vm.runInContext('runDaily()', r.sb);
  inbox.push(withPdf('10/9', '2026-10-09', '3,100', [['Fort Wayne', '9:30 AM', '3100']], '2026-10-10T15:00:00Z'));
  vm.runInContext('runDaily()', r.sb);
  eq(r.pdfs.length, 2, 'a corrected re-send uploads its PDF too');
}
{
  const r = rig([recap('10/9', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z', { pdf: ['notes.txt'] })]);
  vm.runInContext('runDaily()', r.sb);
  eq([r.posts.length, r.pdfs.length], [1, 0], 'a recap with no BL-Live-Recap PDF posts its sales and uploads nothing');
}
{
  const r = rig([withPdf('10/9', '2026-10-09', '3,000', [['Fort Wayne', '9:30 AM', '3000']], '2026-10-10T09:00:00Z')]);
  vm.runInContext('preview()', r.sb);
  eq([r.pdfs.length, r.store.uploadedPdfs], [0, undefined], 'preview uploads and records nothing');
  ok(r.logs.some(l => l.startsWith('2026-10-09') && l.includes('PDF: BL-Live-Recap-2026-10-09.pdf')), 'preview names each day\'s PDF');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
