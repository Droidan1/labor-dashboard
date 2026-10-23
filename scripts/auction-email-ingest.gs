/**
 * Bargain Lane — Online auction results email → labor-dashboard ingest feeder
 * ------------------------------------------------------------------
 * Runs in the Google account that RECEIVES the "Bargain Lane Auction Results"
 * email (bhoward@bargainlane.com). Looker sends it every night with
 * Bargain_Lane_Auction_Results_*.zip attached: the same zip that landed in a
 * Google Drive folder until 2026-10-19.
 *
 * Each run: finds new result emails, unzips the attachment, reads details.csv,
 * sums Hammer Sale per site per sale date, maps the site prefix to a store, and
 * POSTs the daily rollups to the worker's /?action=ingest (channel = "auction").
 *
 * Each zip covers a rolling 7 days, so a day appears in several emails and the
 * newest email's figure is the one to keep. Emails post oldest first, and one
 * older than the newest email already posted is never posted.
 *
 * SETUP (one time):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties → add SNAPSHOT_SECRET (the worker's
 *      secret). It is NOT written in this file: this repo is public.
 *   3. Run `preview` and authorize Gmail when prompted. Check its log (View →
 *      Logs): one line per email, per store and day.
 *   4. Run `backfill` once: posts every results email since the last Drive file.
 *   5. Run `installTrigger` once. runDaily then runs every 10 minutes.
 *
 * The endpoint upserts on (channel, store, date), so re-posting never double-counts.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  // Prod. (Staging: https://api-staging.retjghub.com/?action=ingest)
  INGEST_URL: 'https://api.retjghub.com/?action=ingest',

  CHANNEL: 'auction',

  // Looker sends the scheduled report from this address. Messages in the thread
  // from anyone else (replies, forwards) are ignored.
  SENDER: 'noreply@lookermail.com',
  SUBJECT: 'Bargain Lane Auction Results',
  FILE_PREFIX: 'Bargain_Lane_Auction_Results_',

  // The last Drive file was 2026-10-19 05:00 Eastern. An email sent before it
  // carries older figures than prod already has, so it is never posted.
  FIRST_EMAIL: '2026-10-19T09:00:00Z',

  // Auction site prefix (front of Auction Number) → app store code.
  SITE_TO_STORE: {
    BLB: 'BL14', // Battle Creek
    SBN: 'BL2',  // South Bend
    FTW: 'BL1',  // Coliseum
    BND: 'BL16', // Indy East (BL16; reuses retired Wyoming/BL12 register)
  },
};

// runDaily reads this many days back. Each zip covers 7 days, so a trigger that
// stops for up to 7 days loses nothing; past that, run backfill().
const LOOKBACK_DAYS = 4;

// Looker sends about 06:00 UTC every day. No results email for this long fails
// runDaily, so Apps Script emails you: the Drive feed stopped on 2026-10-19 and
// nothing said so for four days.
const STALE_HOURS = 30;

// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

/**
 * Install the trigger (run once, manually; re-running replaces it).
 * runDaily every 10 minutes: the Executive Summary sends at 5 AM Eastern, and
 * hour triggers fire anywhere in their hour, in the project's time zone (the
 * Whatnot feeder found the same). A run with no new email posts nothing (see
 * postedThrough), so the cadence costs one Gmail search.
 */
function installTrigger() {
  // Clear any existing triggers for runDaily to avoid duplicates.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runDaily')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDaily').timeBased().everyMinutes(10).create();
  Logger.log('Installed trigger: runDaily every 10 minutes');
}

/** Result emails from the last LOOKBACK_DAYS newer than the last one posted. */
function runDaily() {
  _process(_query() + ' newer_than:' + LOOKBACK_DAYS + 'd', 'daily');
}

/** Every result email in the inbox, oldest first, re-posting days already posted.
 *  Run preview() first: this WRITES auction sales for every day it finds. */
function backfill() {
  _process(_query(), 'backfill');
}

/** LOG what backfill() would post, per email, store and day, and any auction
 *  site the store map does not know (its lots are not posted). Posts and
 *  records nothing. */
function preview() {
  _process(_query(), 'preview');
}

function _query() {
  return 'from:' + CONFIG.SENDER + ' subject:"' + CONFIG.SUBJECT + '" has:attachment';
}

// ─── WORK ────────────────────────────────────────────────────────────────────

function _process(query, mode) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('SNAPSHOT_SECRET');
  if (mode !== 'preview' && !secret) throw new Error('Set the SNAPSHOT_SECRET script property first (Project Settings → Script Properties).');
  // Sent time (ms) of the newest email posted. One Script Property, so it never
  // fills up the way a list of every email seen would (9 KB cap).
  let postedThrough = Number(props.getProperty('postedThrough')) || 0;
  const floor = Math.max(Date.parse(CONFIG.FIRST_EMAIL),
    mode === 'daily' ? Date.now() - LOOKBACK_DAYS * 864e5 : 0);

  const emails = [];
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    // Gmail threads emails that share a subject, and a thread matched by
    // newer_than: still holds its old messages: each one is checked here.
    threads.forEach(th => th.getMessages().forEach(m => {
      if (m.isInTrash()) return;   // getMessages() returns a thread's trashed messages too
      if (m.getFrom().toLowerCase().indexOf(CONFIG.SENDER) < 0) return;
      const sent = m.getDate().getTime();
      if (sent < floor) return;
      const zip = m.getAttachments().filter(a => _isResultsZip(a.getName()))[0];
      if (zip) emails.push({ sent: sent, zip: zip });
      else Logger.log('Email of %s has no %s*.zip attachment', new Date(sent).toISOString(), CONFIG.FILE_PREFIX);
    }));
    if (threads.length < 100) break;
  }
  // Oldest first, so each day ends on the newest email's figure.
  emails.sort((a, b) => a.sent - b.sent);

  const failures = [];
  emails.forEach(e => {
    if (mode === 'daily' && e.sent <= postedThrough) return;   // posted, or older than one that was
    const name = e.zip.getName();
    try {
      const files = _unzipCsvs(e.zip);
      if (!files.details) throw new Error('details.csv not found');
      const parsed = parseDetailsCsv_(files.details);
      // hammer_sales.csv is the export's own total. A details.csv cut short (a
      // Looker row limit) would otherwise post a smaller day over a correct one.
      if (files.hammer != null) {
        const table = Utilities.parseCsv(files.hammer);
        const expected = (table[1] && _money(table[1][0])) || 0;
        if (Math.abs(expected - parsed.hammerTotal) >= 0.01) {
          throw new Error('details.csv adds up to $' + parsed.hammerTotal + ' but hammer_sales.csv says $' + expected + '; nothing posted');
        }
      }
      const unmapped = Object.keys(parsed.unmapped).map(p => p + ' (' + parsed.unmapped[p] + ' lots)');
      if (unmapped.length) Logger.log('%s: site not in SITE_TO_STORE, not posted: %s', name, unmapped.join(', '));
      if (mode === 'preview') {
        Logger.log('%s  sent %s  %s', name, new Date(e.sent).toISOString(),
          parsed.rows.map(r => r.store + ' ' + r.date + ' $' + r.total + ' (' + r.count + ' lots)').join('  ') || 'no sold lots');
        return;
      }
      if (parsed.rows.length) _postIngest(parsed.rows, name, secret);
      Logger.log('Ingested %s → %s store-day rows', name, parsed.rows.length);
      if (e.sent > postedThrough) {
        postedThrough = e.sent;
        props.setProperty('postedThrough', String(postedThrough));
      }
    } catch (err) {
      // Not recorded, so retried next run, unless a newer email posts first:
      // it covers the same days.
      Logger.log('ERROR on %s: %s', name, err);
      failures.push(name + ' (' + err.message + ')');
    }
  });
  if (mode === 'daily') {
    const newest = emails.length ? emails[emails.length - 1].sent : 0;
    if (newest < Date.now() - STALE_HOURS * 36e5) {
      failures.push('no results email since ' + (newest ? new Date(newest).toISOString() : 'the last ' + LOOKBACK_DAYS + ' days') +
        ': check that Looker still sends "' + CONFIG.SUBJECT + '" to this inbox with the zip attached');
    }
  }
  // Thrown last, so every other email still posted; Apps Script reports the failed run.
  if (failures.length) throw new Error('Auction results not loaded: ' + failures.join('; '));
}

function _isResultsZip(name) {
  return name.indexOf(CONFIG.FILE_PREFIX) === 0 && /\.zip$/i.test(name);
}

/** The attachment's details.csv and hammer_sales.csv, as text (null when absent). */
function _unzipCsvs(attachment) {
  // Utilities.unzip needs the zip content type; a mail client may label it otherwise.
  const blobs = Utilities.unzip(attachment.copyBlob().setContentType('application/zip'));
  const text = re => { const b = blobs.filter(x => re.test(x.getName()))[0]; return b ? b.getDataAsString() : null; };
  return { details: text(/(^|\/)details\.csv$/i), hammer: text(/(^|\/)hammer_sales\.csv$/i) };
}

// ─── PARSING ──────────────────────────────────────────────────────────────────

/** details.csv → { rows: [{store, date, total, count}], unmapped: {sitePrefix: lots},
 *  hammerTotal: every Hammer Sale in the file, any site or date }. */
function parseDetailsCsv_(csv) {
  const table = Utilities.parseCsv(csv);
  if (!table || table.length < 2) return { rows: [], unmapped: {}, hammerTotal: 0 };

  const header = table[0];
  const idx = name => header.indexOf(name);
  const cAuction = idx('Auction Number');
  const cDate    = idx('Auction End Date Date');
  const cHammer  = idx('Hammer Sale');
  if (cAuction < 0 || cDate < 0 || cHammer < 0) {
    throw new Error('Unexpected columns: ' + header.join('|'));
  }

  // Group by store+date.
  const groups = {}; // key `${store}|${date}` → { store, date, total, count }
  const unmapped = {};
  let hammerTotal = 0;
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const amount = _money(row[cHammer]);
    if (amount != null) hammerTotal += amount;
    const auction = (row[cAuction] || '').trim();
    if (!auction) continue;
    const site = auction.slice(0, 3).toUpperCase();
    const store = CONFIG.SITE_TO_STORE[site];
    if (!store) { unmapped[site] = (unmapped[site] || 0) + 1; continue; }

    if (amount == null) continue; // unsold lot (blank Hammer Sale)

    const date = (row[cDate] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const key = store + '|' + date;
    const g = groups[key] || (groups[key] = { store: store, date: date, total: 0, count: 0 });
    g.total += amount;
    g.count += 1;
  }

  const rows = Object.keys(groups).map(k => {
    const g = groups[k];
    return { store: g.store, date: g.date, total: Math.round(g.total * 100) / 100, count: g.count };
  });
  return { rows: rows, unmapped: unmapped, hammerTotal: Math.round(hammerTotal * 100) / 100 };
}

/** "$1,234.50" | "" | "12" → number | null (null = blank/unsold). */
function _money(v) {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function _postIngest(rows, sourceFile, secret) {
  const res = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Snapshot-Secret': secret },
    payload: JSON.stringify({ channel: CONFIG.CHANNEL, source_file: sourceFile, rows: rows }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Ingest HTTP ' + code + ': ' + res.getContentText());
  }
  return res.getContentText();
}
