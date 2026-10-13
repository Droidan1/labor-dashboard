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
    getDate: () => new Date(sent), getAttachments: () => pdf.map(n => ({ getName: () => n })),
  };
}
const recap = (md, total, lines, sent, extra = {}) => msg({
  subject: `Bargain Lane Live recap – Fri ${md}: $${total} on ${lines.length} show${lines.length === 1 ? '' : 's'}`,
  body: lines.map(([loc, time, amt]) => `- ${loc}, ${time}, "Show": $${amt} in sales, 10 items, 5 shipments, 1 new buyers`).join('\n'),
  sent, ...extra,
});

function rig(inbox, props = {}) {
  const posts = [], mails = [], logs = [];
  const store = { SNAPSHOT_SECRET: 's3cret', ...props };
  const sb = {
    GmailApp: { search: (q, start) => (start === 0 ? inbox.map(m => ({ getMessages: () => [m] })) : []) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large'); store[k] = String(v); },
    }) },
    UrlFetchApp: { fetch: (u, o) => { posts.push(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }; } },
    MailApp: { sendEmail: (to, subject) => mails.push(subject) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    Logger: { log: s => logs.push(String(s)) },
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return { sb, posts, mails, logs, store };
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
