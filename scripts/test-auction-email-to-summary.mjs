// The auction results email, end to end into the 5 AM Executive Summary.
//
// Looker sends "Bargain Lane Auction Results" at about 2 AM Eastern every day
// (06:00 UTC); the feeder (scripts/auction-email-ingest.gs) runs every 10 minutes,
// so by 5 AM yesterday's online auction is in daily_sales.auction and the summary
// counts it. Brian, 2026-10-23: "make sure it's added to the executive summary, no
// need to add the pdf on this though" — the summary has no auction attachment.
//
// The feeder runs unmodified in a VM (fake Gmail); the payload it would POST goes
// through the real worker.fetch, and the summary is the real preview route, which
// builds the body the 5 AM send uses. Lots are invented (the export carries bidder
// usernames); the store-day totals are the real 2026-10-23 email's.
process.env.TZ = 'UTC';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const has = (html, s, m) => ok(html.includes(s), `${m} (looking for ${JSON.stringify(s)})`);

// ── The 2 AM email, read by the feeder at 2:10 AM ───────────────────────────
const HEADER = ',Auction Number,Auction End Date Date,Lot Code,Load Number,Title,Lotter Username,Grade,MSRP (USD),Hammer Sale,Location Readable,Winning Bidder,Distinct Bidders,Bid Count,Identifier ID,Identifier Value,UPC,Category 1,Category 2,Refund Hammer,Description';
const lot = (auction, date, hammer) => ['1', auction, date, 'L1', 'LD1', 'Item', 'lotter', 'A', '$10.00', hammer,
  auction.slice(0, 3) + '-01-01-01', 'bidder', '2', '3', '', '', '', 'Home', 'Kitchen', '$0.00', 'desc'].join(',');
const details = [HEADER,
  lot('BND2600033', '2026-10-18', '$248.82'),
  lot('BLB2600069', '2026-10-18', '$215.13'),
  lot('BLB2600070', '2026-10-19', '$204.50'),
  lot('BND2600034', '2026-10-19', '$417.31'),
  lot('BND2600035', '2026-10-20', '$447.11'),
  lot('BND2600036', '2026-10-21', '$628.63'),
  lot('BLB2600071', '2026-10-22', ''),          // listed before it ends, nothing sold yet
].join('\n');
const parseCsv = (t) => t.split('\n').map(l => l.split(','));
const files = { 'details.csv': details, 'hammer_sales.csv': 'HammerSales\n$2161.50' };

const NOW = Date.parse('2026-10-22T06:10:00Z');   // 2:10 AM EDT, the first run after it lands
const posts = [];
const sb = {
  Date: class extends Date { constructor(...a) { if (a.length === 0) super(NOW); else super(...a); } static now() { return NOW; } },
  GmailApp: { search: (q, start) => (start ? [] : [{ getMessages: () => [{
    isInTrash: () => false, getFrom: () => 'Looker <noreply@lookermail.com>', getDate: () => new Date('2026-10-22T06:00:20Z'),
    getAttachments: () => [{ getName: () => 'Bargain_Lane_Auction_Results_2026-10-22T0200.zip', copyBlob: () => ({ setContentType: () => 'zip' }) }],
  }] }]) },
  Utilities: { parseCsv, unzip: () => Object.keys(files).map(n => ({ getName: () => 'dashboard-bargain_lane_auction_results/' + n, getDataAsString: () => files[n] })) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'SNAPSHOT_SECRET' ? 'feeder-secret' : null), setProperty: () => {} }) },
  UrlFetchApp: { fetch: (url, o) => { posts.push({ url, secret: o.headers['X-Snapshot-Secret'], body: JSON.parse(o.payload) }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
  Logger: { log: () => {} },
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(repo, 'scripts/auction-email-ingest.gs'), 'utf8'), sb);
vm.runInContext('runDaily()', sb);
ok(posts.length === 1 && posts[0].url === 'https://api.retjghub.com/?action=ingest', 'the feeder posts the email once, to prod ingest');

// ── Into the worker, then the summary for Wed Oct 21 (sent Thu Oct 22, 5 AM) ─
blockNetwork();
const worker = await loadWorker(repo);
const h = makeEnv(repo);
h.db.exec(fs.readFileSync(path.join(repo, 'migration-015.sql'), 'utf8'));
applyMigrationAlters(h.db, repo);
h.env.SNAPSHOT_SECRET = 'feeder-secret';
h.db.exec('DELETE FROM daily_sales');
// POS: every open store sold 1,000 against a 1,200 plan each day of the week so far.
const ins = h.db.prepare('INSERT INTO daily_sales (store, date, total, budget, snapshot_time) VALUES (?, ?, 1000, 1200, ?)');
for (const date of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']) {
  for (const s of ['BL1', 'BL4', 'BL2', 'BL14', 'BL16']) ins.run(s, date, date + 'T23:55:00Z');
}

for (const p of posts) {
  const r = await worker.fetch(req('/?action=ingest', { method: 'POST', body: p.body, secret: p.secret }), h.env, ctx);
  ok(r.status === 200, `ingest accepts the feeder's payload with its secret (HTTP ${r.status})`);
}
const auction = (s, d) => (h.db.prepare('SELECT auction FROM daily_sales WHERE store = ? AND date = ?').get(s, d) || {}).auction;
ok(auction('BL16', '2026-10-21') === 628.63, `yesterday's Indy East auction is in daily_sales (${auction('BL16', '2026-10-21')})`);
ok(auction('BL14', '2026-10-22') == null, 'the not-yet-ended 10-22 auction posts nothing for 10-22');

const res = await worker.fetch(req('/?action=preview-daily-summary&date=2026-10-21', { user: 'u-su' }), h.env, ctx);
const html = await res.text();
ok(res.status === 200, 'the summary renders');
// Worked by hand. Yesterday: Indy East 1,000 + 628.63 = 1,628.63 -> $1,629; 629 / 1,629 = 38.6%.
has(html, '* Yesterday live sales included above: Indy East $629 (38.6% of Indy East yesterday sales).', 'yesterday\'s online auction is in the Yesterday table');
// WTD (Sun 10-18 .. Wed 10-21): Battle Creek 215.13 + 204.50 = 419.63 -> $420 of 4,419.63 -> $4,420 = 9.5%;
// Indy East 248.82 + 417.31 + 447.11 + 628.63 = 1,741.87 -> $1,742 of 5,741.87 -> $5,742 = 30.3%.
has(html, '* WTD live sales included above: Battle Creek $420 (9.5% of Battle Creek WTD sales); Indy East $1,742 (30.3% of Indy East WTD sales).', 'and in week to date');
// Total WTD = 5 stores x 4 days x 1,000 + 419.63 + 1,741.87 = 22,161.50 -> rows 4,000 x 3 + 4,420 + 5,742 = $22,162.
has(html, '>$22,162</div>', 'and in the headline Total WTD Sales');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
