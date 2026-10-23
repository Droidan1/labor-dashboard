// The online-auction feeder (scripts/auction-email-ingest.gs), loaded unmodified
// in a VM with fake Apps Script services: its schedule, its parser, and its
// Gmail run loop.
//
// 2026-10-19: the Executive Summary moved to 5 AM Eastern. The feeder ran at 7 AM,
// 1 PM and 5 PM, so yesterday's online auction would have missed the email every
// day. It now runs every 10 minutes, as the Whatnot feeder does (hour triggers fire
// anywhere in their hour, in the project's time zone).
//
// 2026-10-23: the results zip stopped landing in Google Drive and arrives by email
// (Looker, "Bargain Lane Auction Results"). Each zip covers a rolling 7 days, so a
// day is in several emails and the NEWEST email's figure must be what stays stored:
// emails post oldest first, and one older than an email already posted never posts.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(repo, 'scripts/auction-email-ingest.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ── Schedule ─────────────────────────────────────────────────────────────────
{
  const made = [], deleted = [];
  const builder = (fn) => { const t = { fn }; return {
    timeBased: () => ({
      everyMinutes: (n) => ({ create: () => { t.minutes = n; made.push(t); } }),
      everyDays: () => ({ atHour: (h) => ({ create: () => { t.hour = h; made.push(t); } }) }),
    }) }; };
  const sb = {
    ScriptApp: {
      getProjectTriggers: () => [7, 13, 17].map(h => ({ getHandlerFunction: () => 'runDaily', id: 'old' + h }))
        .concat([{ getHandlerFunction: () => 'other', id: 'keep' }]),
      deleteTrigger: (t) => deleted.push(t.id),
      newTrigger: builder,
    },
    Logger: { log: () => {} },
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  vm.runInContext('installTrigger()', sb);
  eq(deleted, ['old7', 'old13', 'old17'], 'replaces the old 7 AM / 1 PM / 5 PM runDaily triggers, and only those');
  eq(made.map(t => [t.fn, t.minutes, t.hour]), [['runDaily', 10, undefined]], 'one trigger: runDaily every 10 minutes, no fixed hour');
}

// ── Fakes ────────────────────────────────────────────────────────────────────
// The header is the real export's, leading blank column included. The rows are
// invented: the real file carries bidder usernames, and this repo is public.
const HEADER = ',Auction Number,Auction End Date Date,Lot Code,Load Number,Title,Lotter Username,Grade,MSRP (USD),Hammer Sale,Location Readable,Winning Bidder,Distinct Bidders,Bid Count,Identifier ID,Identifier Value,UPC,Category 1,Category 2,Refund Hammer,Description';
const lot = (auction, date, hammer, title = 'Item') =>
  ['1', auction, date, 'L1', 'LD1', `"${title}"`, 'lotter', 'A', '$10.00', hammer.includes(',') ? `"${hammer}"` : hammer,
   auction.slice(0, 3) + '-01-01-01', 'bidder', '2', '3', '', '', '', 'Home', 'Kitchen', '$0.00', '"desc"'].join(',');
const csvOf = (lots) => [HEADER, ...lots].join('\n');

// Quote-aware CSV split, standing in for Utilities.parseCsv.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows;
}

// 29 hours after the 10-22 email: inside STALE_HOURS (30).
const NOW = Date.parse('2026-10-23T11:00:00Z');
const LOOKER = 'Looker <noreply@lookermail.com>';
// hammer_sales.csv as the export writes it: the sum of every Hammer Sale in details.csv.
const hammerOf = (csv) => {
  const t = parseCsv(csv), c = t[0].indexOf('Hammer Sale');
  const sum = t.slice(1).reduce((s, r) => s + (Number(String(r[c] || '').replace(/[$,]/g, '')) || 0), 0);
  return `HammerSales\n"$${sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`;
};
// One email. `csv: null` = a zip with no details.csv in it; `hammer: null` = no hammer_sales.csv.
const email = (sentIso, csv, { from = LOOKER, name, extra = [], hammer, trashed = false } = {}) => {
  const zipName = name || `Bargain_Lane_Auction_Results_${sentIso.slice(0, 10)}T0200.zip`;
  const hammerCsv = hammer === undefined ? (csv == null ? null : hammerOf(csv)) : hammer;
  const zip = { getName: () => zipName, copyBlob: () => ({ setContentType: (t) => ({ type: t, csv, hammerCsv, zipName }) }) };
  return {
    isInTrash: () => trashed,
    getFrom: () => from, getDate: () => new Date(sentIso),
    getAttachments: () => extra.map(n => ({ getName: () => n, copyBlob: () => { throw new Error('read a non-zip attachment'); } })).concat([zip]),
  };
};

function rig(threads, props = {}, { ingestCode = () => 200 } = {}) {
  const posts = [], logs = [], queries = [], unzipped = [];
  const store = { SNAPSHOT_SECRET: 's3cret', ...props };
  const sb = {
    Date: class extends Date { constructor(...a) { if (a.length === 0) super(NOW); else super(...a); } static now() { return NOW; } },
    // Gmail returns threads newest first; each thread holds its messages oldest first.
    GmailApp: { search: (q, start) => { queries.push(q); return start === 0 ? threads.map(msgs => ({ getMessages: () => msgs })) : []; } },
    Utilities: {
      unzip: (blob) => {
        unzipped.push(blob.zipName);
        if (blob.type !== 'application/zip') throw new Error('Utilities.unzip: not a zip');
        const f = (n, s) => ({ getName: () => 'dashboard-bargain_lane_auction_results/' + n, getDataAsString: () => s });
        return [f('avg_hammer_sales.csv', 'AvgHammerSales\n"$4.66"'), f('refunds.csv', 'Refund HammerSale\n$0.00')]
          .concat(blob.hammerCsv == null ? [] : [f('hammer_sales.csv', blob.hammerCsv)])
          .concat(blob.csv == null ? [] : [f('details.csv', blob.csv)]);
      },
      parseCsv,
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }) },
    UrlFetchApp: { fetch: (u, o) => {
      const code = ingestCode(posts.length);
      posts.push({ url: u, secret: o.headers['X-Snapshot-Secret'], body: JSON.parse(o.payload), code });
      return { getResponseCode: () => code, getContentText: () => (code === 200 ? '{"ok":true}' : '{"error":"x"}') };
    } },
    Logger: { log: (f, ...a) => { let i = 0; logs.push(String(f).replace(/%s/g, () => String(a[i++]))); } },
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  const run = (fn) => { try { vm.runInContext(fn + '()', sb); return null; } catch (e) { return e.message; } };
  return { sb, posts, logs, queries, unzipped, store, run };
}
const sent = (posts) => posts.map(p => p.body.source_file);

// ── Parsing: the real header, same rules as the Drive feeder ────────────────
{
  const r = rig([]);
  const out = r.sb.parseDetailsCsv_(csvOf([
    lot('BLB2600070', '2026-10-18', '$3.50', 'Pan, 10 in'),     // comma inside a quoted title
    lot('BLB2600070', '2026-10-18', '$1,204.50'),               // quoted, as the export writes it
    lot('BND2600111', '2026-10-21', '$2.00'),
    lot('BND2600111', '2026-10-21', ''),                         // unsold: blank Hammer Sale
    lot('FTW2600001', 'not a date', '$9.00'),
    lot('XYZ2600001', '2026-10-21', '$5.00'),                    // a site the map does not know
    lot('XYZ2600002', '2026-10-21', ''),
  ]));
  eq(out.rows, [
    { store: 'BL14', date: '2026-10-18', total: 1208, count: 2 },
    { store: 'BL16', date: '2026-10-21', total: 2, count: 1 },
  ], 'sums Hammer Sale per store and sale date; skips unsold lots and bad dates');
  eq(out.unmapped, { XYZ: 2 }, 'reports lots from an unmapped site instead of dropping them silently');
  eq(out.hammerTotal, 1224, 'hammerTotal is every Hammer Sale in the file, any site or date (what hammer_sales.csv sums)');
  const bad = rig([]);
  let msg = '';
  try { bad.sb.parseDetailsCsv_('Auction,Date\nBLB1,2026-10-18'); } catch (e) { msg = e.message; }
  ok(/Unexpected columns/.test(msg), 'a renamed column stops the email rather than posting nothing quietly');
}

const D20 = email('2026-10-20T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$400.00')]));
const D21 = email('2026-10-21T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$410.00')]));
const D22 = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$417.31'), lot('BLB2600070', '2026-10-19', '$204.50')]));

// ── 1. Oldest first, so each day ends on the newest email's figure ──────────
{
  const r = rig([[D22], [D21], [D20]]);   // newest first, as Gmail returns them
  eq(r.run('runDaily'), null, 'runDaily completes');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-20T0200.zip', 'Bargain_Lane_Auction_Results_2026-10-21T0200.zip', 'Bargain_Lane_Auction_Results_2026-10-22T0200.zip'],
    'posts the emails oldest first');
  eq((r.posts[2] || {}).body, { channel: 'auction', source_file: 'Bargain_Lane_Auction_Results_2026-10-22T0200.zip',
    rows: [{ store: 'BL16', date: '2026-10-19', total: 417.31, count: 1 }, { store: 'BL14', date: '2026-10-19', total: 204.5, count: 1 }] },
    'the last post carries the newest figures, as the ingest endpoint expects');
  ok(r.posts.every(p => p.secret === 's3cret' && p.url === 'https://api.retjghub.com/?action=ingest'), 'posts to prod ingest with the Script Property secret');
  eq(r.store.postedThrough, String(Date.parse('2026-10-22T06:00:20Z')), 'records the newest email posted');
  ok(/from:noreply@lookermail\.com/.test(r.queries[0]) && /subject:"Bargain Lane Auction Results"/.test(r.queries[0]) && / newer_than:4d$/.test(r.queries[0]),
    `runDaily searches Looker's results email from the last 4 days (${r.queries[0]})`);

  r.posts.length = 0;
  r.run('runDaily');
  eq(r.posts.length, 0, 'a second run posts nothing');
}

// ── 2. An email older than one already posted never posts ───────────────────
{
  // The 10-22 email posted on an earlier run; the 10-21 one shows up late (or failed then).
  const r = rig([[D22], [D21]], { postedThrough: String(Date.parse('2026-10-22T06:00:20Z')) });
  r.run('runDaily');
  eq(r.posts.length, 0, 'the older email would put 10-19 back to $410: not posted');
}

// ── 3. One email failing does not hold up a newer one ───────────────────────
{
  const broken = email('2026-10-21T06:00:20Z', null);
  const r = rig([[D22], [broken]]);
  const err = r.run('runDaily');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-22T0200.zip'], 'the newer email still posts');
  ok(/Bargain_Lane_Auction_Results_2026-10-21T0200\.zip \(details\.csv not found\)/.test(err || ''), `the run then fails, naming the broken email (${err})`);
  r.posts.length = 0;
  r.run('runDaily');
  eq(r.posts.length, 0, 'the broken one is not retried: the newer email already covers its days');
}
{
  const r = rig([[D22], [D21]], {}, { ingestCode: (n) => (n === 1 ? 503 : 200) });
  const err = r.run('runDaily');
  ok(/HTTP 503/.test(err || ''), 'a failed POST of the newest email fails the run');
  eq(r.store.postedThrough, String(Date.parse('2026-10-21T06:00:20Z')), 'and is not recorded as posted');
  r.posts.length = 0;
  r.run('runDaily');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-22T0200.zip'], 'so the next run retries it');
}

// ── 4. What in the inbox is not a results email ─────────────────────────────
{
  const reply = email('2026-10-22T13:00:00Z', csvOf([lot('BND1', '2026-10-19', '$1.00')]), { from: 'Brian <bhoward@bargainlane.com>' });
  const other = email('2026-10-22T07:00:00Z', csvOf([lot('BND1', '2026-10-19', '$1.00')]), { name: 'Some_Other_Report.zip' });
  const withPng = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$417.31')]), { extra: ['logo.png'] });
  // Same thread, after the last Drive file but more than 4 days old: runDaily must
  // not even open it (a thread holds up to 100 messages, read every 10 minutes).
  const old = email('2026-10-19T10:00:00Z', csvOf([lot('BND2600111', '2026-10-17', '$1.00')]));
  let oldRead = false;
  const oldAtt = old.getAttachments;
  old.getAttachments = () => { oldRead = true; return oldAtt(); };
  const r = rig([[old, withPng, reply], [other]]);
  eq(r.run('runDaily'), null, 'runDaily completes');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-22T0200.zip'],
    'posts only Looker\'s results zip: not a reply, not another report, not a message older than 4 days in the same thread');
  ok(!oldRead, 'does not open the attachments of a message older than 4 days');
}

// ── 5. Never an email from before the last Drive file ───────────────────────
{
  // The Drive file of 2026-10-19 05:00 ET is what prod holds for those days.
  const before = email('2026-10-19T06:00:20Z', csvOf([lot('BND2600111', '2026-10-17', '$1.00')]));
  const after = email('2026-10-20T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$400.00')]));
  const r = rig([[after], [before]]);
  r.run('backfill');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-20T0200.zip'], 'backfill skips an email sent before the last Drive file');
  ok(!/newer_than/.test(r.queries[0]), 'backfill searches the whole inbox');
}

// ── 6. backfill re-posts; preview posts and records nothing ─────────────────
{
  const r = rig([[D22], [D21]], { postedThrough: String(Date.parse('2026-10-22T06:00:20Z')) });
  r.run('backfill');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-21T0200.zip', 'Bargain_Lane_Auction_Results_2026-10-22T0200.zip'], 'backfill re-posts every email, oldest first');
}
{
  // More than 4 days old but after the last Drive file: day 10-18 is only in emails like this one.
  const d19 = email('2026-10-19T10:00:00Z', csvOf([lot('BND2600111', '2026-10-18', '$248.82')]));
  const r = rig([[D21], [d19]], { postedThrough: String(Date.parse('2026-10-22T06:00:20Z')) });
  r.run('backfill');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-19T0200.zip', 'Bargain_Lane_Auction_Results_2026-10-21T0200.zip'], 'backfill is not limited to the last 4 days');
  eq(r.store.postedThrough, String(Date.parse('2026-10-22T06:00:20Z')), 'and never moves postedThrough backwards');
}
{
  const unknown = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$417.31'), lot('XYZ1', '2026-10-19', '$5.00')]));
  const r = rig([[unknown]], { SNAPSHOT_SECRET: null });
  delete r.store.SNAPSHOT_SECRET;
  eq(r.run('preview'), null, 'preview runs without the secret');
  eq(r.posts.length, 0, 'preview posts nothing');
  ok(!('postedThrough' in r.store), 'preview records nothing');
  ok(r.logs.some(l => /BL16 2026-10-19 \$417\.31 \(1 lots\)/.test(l)), 'preview logs each store and day');
  ok(r.logs.some(l => /not in SITE_TO_STORE.*XYZ \(1 lots\)/.test(l)), 'preview names a site the map does not know');
  const err = r.run('runDaily');
  ok(/SNAPSHOT_SECRET/.test(err || '') && r.posts.length === 0, 'runDaily without the secret stops before posting anything');
}

// ── 7. details.csv must add up to the export's own hammer_sales.csv ─────────
{
  // A Looker row limit would cut details.csv short; posting it would put a smaller
  // day over a correct one.
  const cut = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$417.31')]), { hammer: 'HammerSales\n"$2,379.01"' });
  const r = rig([[cut], [D21]]);
  const err = r.run('runDaily');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-21T0200.zip'], 'an email whose details.csv does not add up is not posted');
  ok(/adds up to \$417\.31 but hammer_sales\.csv says \$2379\.01/.test(err || ''), `and the run says why (${err})`);
  const noTotal = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$417.31')]), { hammer: null });
  const r2 = rig([[noTotal]]);
  r2.run('runDaily');
  eq(sent(r2.posts), ['Bargain_Lane_Auction_Results_2026-10-22T0200.zip'], 'a zip without hammer_sales.csv still posts');
}

// ── 8. A trashed email is not posted ────────────────────────────────────────
{
  const bad = email('2026-10-22T06:00:20Z', csvOf([lot('BND2600111', '2026-10-19', '$1.00')]), { trashed: true });
  const r = rig([[D21, bad]]);
  r.run('runDaily');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-21T0200.zip'], 'a deleted email in the thread does not post (it would win as the newest)');
}

// ── 9. The feed stopping is an error, not a quiet morning ───────────────────
{
  const r = rig([[D20]]);
  const err = r.run('runDaily');
  eq(sent(r.posts), ['Bargain_Lane_Auction_Results_2026-10-20T0200.zip'], 'what there is still posts');
  ok(/no results email since 2026-10-20T06:00:20\.000Z/.test(err || ''), `then runDaily fails: newest email over 30 hours old (${err})`);
  const empty = rig([]);
  ok(/no results email since the last 4 days/.test(empty.run('runDaily') || ''), 'and fails when there is none at all');
  ok(empty.run('preview') === null && empty.run('backfill') === null, 'preview and backfill do not raise it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
