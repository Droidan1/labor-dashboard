/**
 * Bargain Lane — Auction sales → labor-dashboard ingest feeder
 * ------------------------------------------------------------------
 * Runs in YOUR Google account (script.google.com), so it already has
 * access to the Drive folder — no credentials are shared with anyone.
 *
 * Each run: finds new "Bargain_Lane_Auction_Results_*.zip" files in the
 * folder, unzips, reads details.csv, sums Hammer Sale per site per sale
 * date, maps the site prefix to a store, and POSTs the daily rollups to
 * the worker's generic /?action=ingest endpoint (channel = "auction").
 *
 * SETUP (one time):
 *   1. script.google.com → New project → paste this file.
 *   2. Fill in the CONFIG block below (FOLDER_ID + SNAPSHOT_SECRET).
 *   3. Run `installTrigger` once and authorize when prompted.
 *      (That schedules runDaily every morning ~6 AM.)
 *   4. Optional: run `runDaily` manually to backfill what's in the folder now.
 *
 * The endpoint is idempotent (UNIQUE channel+store+date), so re-running or
 * re-processing the same files never double-counts.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  // From the Drive folder URL: .../folders/<THIS PART>
  FOLDER_ID: '1EWOC5orP0iFBqE2RwF3Tw_I6WPXKyv6J',

  // Prod. (Staging: https://api-staging.retjghub.com/?action=ingest)
  INGEST_URL: 'https://api.retjghub.com/?action=ingest',

  // Must match env.SNAPSHOT_SECRET in wrangler.toml — currently: mapcaj-saTxa2-1
  SNAPSHOT_SECRET: 'mapcaj-saTxa2-1',

  CHANNEL: 'auction',

  // Auction site prefix (front of Auction Number) → app store code.
  SITE_TO_STORE: {
    BLB: 'BL14', // Battle Creek
    SBN: 'BL2',  // South Bend
    FTW: 'BL1',  // Coliseum
    BND: 'BL16', // Indy East (BL16; reuses retired Wyoming/BL12 register)
  },

  FILE_PREFIX: 'Bargain_Lane_Auction_Results_',
};

// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

/**
 * Install the daily triggers (run once, manually).
 * 7 AM = primary (after the zip lands ~6–7 AM); 1 PM + 5 PM = idempotent safety
 * nets in case the 7 AM run is skipped/errors (Apps Script triggers are
 * best-effort). Re-POSTing is safe — the endpoint upserts on (channel,store,date).
 */
function installTrigger() {
  // Clear any existing triggers for runDaily to avoid duplicates.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runDaily')
    .forEach(t => ScriptApp.deleteTrigger(t));
  [7, 13, 17].forEach(h =>
    ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(h).create());
  Logger.log('Installed daily triggers: runDaily @ 7 AM, 1 PM, 5 PM');
}

/** Main job: process any not-yet-seen auction result zips. */
function runDaily() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const seen = _seenFileIds();
  const files = folder.getFiles();

  let processed = 0;
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf(CONFIG.FILE_PREFIX) !== 0) continue;          // not an auction-results zip
    if (name.slice(-4).toLowerCase() !== '.zip') continue;
    if (seen[file.getId()]) continue;                              // already ingested

    try {
      const rows = _parseAuctionZip(file);
      if (rows.length) {
        _postIngest(rows, name);
        Logger.log('Ingested %s → %s store-day rows', name, rows.length);
      } else {
        Logger.log('No sold lots in %s (empty/early file) — marking seen', name);
      }
      _markSeen(file.getId());
      processed++;
    } catch (err) {
      Logger.log('ERROR on %s: %s', name, err);
      // Not marked seen → retried next run.
    }
  }
  Logger.log('runDaily complete. Files processed this run: %s', processed);
}

/**
 * Dry run — logs every distinct auction-site prefix across all zips with its
 * lot count and mapped store (or "UNMAPPED"). Run this FIRST after adding a new
 * site to confirm the prefix is right (e.g. that Indy really is "BND"). Writes
 * nothing — no POST, no seen-marking.
 */
function auditSitePrefixes() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = folder.getFiles();
  const tally = {}; // prefix → { lots, store }
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf(CONFIG.FILE_PREFIX) !== 0) continue;
    if (name.slice(-4).toLowerCase() !== '.zip') continue;
    try {
      const blobs = Utilities.unzip(file.getBlob());
      const detailsBlob = blobs.filter(b => /details\.csv$/i.test(b.getName()))[0];
      if (!detailsBlob) continue;
      const table = Utilities.parseCsv(detailsBlob.getDataAsString());
      const cAuction = table[0].indexOf('Auction Number');
      if (cAuction < 0) continue;
      for (let i = 1; i < table.length; i++) {
        const a = (table[i][cAuction] || '').trim();
        if (!a) continue;
        const p = a.slice(0, 3).toUpperCase();
        (tally[p] || (tally[p] = { lots: 0 })).lots++;
      }
    } catch (err) { Logger.log('skip %s: %s', name, err); }
  }
  Object.keys(tally).sort().forEach(p =>
    Logger.log('%s → %s  (%s lots)', p, CONFIG.SITE_TO_STORE[p] || 'UNMAPPED', tally[p].lots));
}

/**
 * One-time backfill — reprocess EVERY auction zip in the folder, ignoring the
 * seen-file bookkeeping. Use after adding a new site→store mapping (e.g. Indy)
 * to pull in historical rows for the newly-mapped site. The ingest endpoint is
 * idempotent on UNIQUE(channel,store,date), so already-ingested stores just
 * re-upsert the same values — no double-counting.
 */
function backfillReprocessAll() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = folder.getFiles();
  let processed = 0;
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf(CONFIG.FILE_PREFIX) !== 0) continue;
    if (name.slice(-4).toLowerCase() !== '.zip') continue;
    try {
      const rows = _parseAuctionZip(file);
      if (rows.length) {
        _postIngest(rows, name);
        Logger.log('Backfilled %s → %s store-day rows', name, rows.length);
      }
      _markSeen(file.getId());
      processed++;
    } catch (err) {
      Logger.log('ERROR on %s: %s', name, err);
    }
  }
  Logger.log('backfillReprocessAll complete. Files processed: %s', processed);
}

// ─── PARSING ──────────────────────────────────────────────────────────────────

/** Unzip one auction-results zip → array of {store, date, total, count, meta}. */
function _parseAuctionZip(file) {
  const blobs = Utilities.unzip(file.getBlob());
  const detailsBlob = blobs.filter(b => /details\.csv$/i.test(b.getName()))[0];
  if (!detailsBlob) throw new Error('details.csv not found in ' + file.getName());

  const table = Utilities.parseCsv(detailsBlob.getDataAsString());
  if (!table || table.length < 2) return [];

  const header = table[0];
  const idx = name => header.indexOf(name);
  const cAuction = idx('Auction Number');
  const cDate    = idx('Auction End Date Date');
  const cHammer  = idx('Hammer Sale');
  if (cAuction < 0 || cDate < 0 || cHammer < 0) {
    throw new Error('Unexpected columns: ' + header.join('|'));
  }

  // Group by store+date.
  const groups = {}; // key `${store}|${date}` → { store, date, total, count, dropped }
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const auction = (row[cAuction] || '').trim();
    if (!auction) continue;
    const site = auction.slice(0, 3).toUpperCase();
    const store = CONFIG.SITE_TO_STORE[site];
    if (!store) continue; // BND or unknown — skipped

    const amount = _money(row[cHammer]);
    if (amount == null) continue; // unsold lot (blank Hammer Sale)

    const date = (row[cDate] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const key = store + '|' + date;
    const g = groups[key] || (groups[key] = { store: store, date: date, total: 0, count: 0 });
    g.total += amount;
    g.count += 1;
  }

  return Object.keys(groups).map(k => {
    const g = groups[k];
    return { store: g.store, date: g.date, total: Math.round(g.total * 100) / 100, count: g.count };
  });
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

function _postIngest(rows, sourceFile) {
  const res = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Snapshot-Secret': CONFIG.SNAPSHOT_SECRET },
    payload: JSON.stringify({ channel: CONFIG.CHANNEL, source_file: sourceFile, rows: rows }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Ingest HTTP ' + code + ': ' + res.getContentText());
  }
  return res.getContentText();
}

// ─── PROCESSED-FILE BOOKKEEPING (non-destructive — never moves/deletes files) ──

function _seenFileIds() {
  const raw = PropertiesService.getScriptProperties().getProperty('seenFileIds');
  return raw ? JSON.parse(raw) : {};
}
function _markSeen(id) {
  const seen = _seenFileIds();
  seen[id] = Date.now();
  PropertiesService.getScriptProperties().setProperty('seenFileIds', JSON.stringify(seen));
}
