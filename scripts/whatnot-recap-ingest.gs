/**
 * Bargain Lane Live (Whatnot) recap email → labor-dashboard ingest feeder
 * ------------------------------------------------------------------
 * Runs in the Google account that RECEIVES the "Bargain Lane Live recap"
 * email (bhoward@bargainlane.com). Each run finds recap emails, reads the show
 * lines out of the plain-text body, sums gross sales per store, and POSTs one
 * row per store per day to the worker's /?action=ingest (channel = "whatnot").
 * The worker adds them to the online-auction feed as the store's live sales.
 *
 * The recap's own month-to-date line rides along as `reconcile`, so the worker
 * pushes an alert the morning after a day goes missing.
 *
 * A recap is posted only if its show lines add up to the total and show count
 * in its subject line. Anything else (a format change, a location it does not
 * know) posts NOTHING and emails you instead: a wrong number in the Executive
 * Summary is worse than a missing one.
 *
 * SETUP (one time):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties → add SNAPSHOT_SECRET (the worker's
 *      secret). It is NOT written in this file: this repo is public.
 *   3. Run `installTrigger` once and authorize Gmail when prompted.
 *   4. Run `backfill` once to load every recap already in the inbox.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  // Prod. (Staging: https://api-staging.retjghub.com/?action=ingest)
  INGEST_URL: 'https://api.retjghub.com/?action=ingest',
  CHANNEL: 'whatnot',

  // The recap tool sends from this address; forwards of it come from it too.
  // Messages in the thread from anyone else (replies) are ignored.
  SENDER: 'bgeorges@retjg.com',
  SUBJECT: 'Bargain Lane Live recap',

  // Location as the recap names it → app store. The recap assigns it by show
  // start time (before 3:30 PM = Fort Wayne). Fort Wayne is Coliseum, never
  // Dupont. A location not listed here stops the whole recap.
  LOCATION_TO_STORE: {
    'Fort Wayne': 'BL1',     // Coliseum
    'Battle Creek': 'BL14',  // Battle Creek
  },
};

// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

/** Install the daily triggers (run once). The recap lands ~5 AM ET; the
 *  Executive Summary sends at 8 AM. 6 AM is primary, 7 AM and 1 PM are
 *  idempotent safety nets (Apps Script triggers fire within the hour). */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runDaily')
    .forEach(t => ScriptApp.deleteTrigger(t));
  [6, 7, 13].forEach(h =>
    ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(h).create());
  Logger.log('Installed daily triggers: runDaily @ 6 AM, 7 AM, 1 PM');
}

/** Recaps from the last few days that have not been posted yet. */
function runDaily() {
  _process(_query() + ' newer_than:4d', false);
}

/** Every recap in the inbox, oldest first, ignoring what was already posted.
 *  Safe to re-run: the endpoint upserts on (channel, store, date). */
function backfill() {
  _process(_query(), true);
}

function _query() { return 'from:' + CONFIG.SENDER + ' subject:"' + CONFIG.SUBJECT + '"'; }

// ─── WORK ────────────────────────────────────────────────────────────────────

function _process(query, ignoreSeen) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('SNAPSHOT_SECRET');
  if (!secret) throw new Error('Set the SNAPSHOT_SECRET script property first (Project Settings → Script Properties).');
  const seen = JSON.parse(props.getProperty('seenMessageIds') || '{}');

  // Newest message per recap date (an original and its forward say the same thing).
  const byDate = {};
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    threads.forEach(th => th.getMessages().forEach(m => {
      if (!ignoreSeen && seen[m.getId()]) return;
      if (m.getFrom().toLowerCase().indexOf(CONFIG.SENDER) < 0) return;
      let recap;
      try {
        recap = parseRecap_(m.getSubject(), m.getPlainBody(),
          m.getAttachments().map(a => a.getName()), m.getDate());
      } catch (e) {
        if (!seen[m.getId()]) _alertOnce(m, e, props, seen);
        return;
      }
      if (!recap) return;                                   // not a recap (a reply about one, etc.)
      const prev = byDate[recap.date];
      if (!prev || m.getDate() > prev.msg.getDate()) byDate[recap.date] = { recap, msg: m };
    }));
    if (threads.length < 100) break;
  }

  // Oldest first, so each recap's month-to-date check sees every earlier day.
  Object.keys(byDate).sort().forEach(date => {
    const { recap, msg } = byDate[date];
    const res = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Snapshot-Secret': secret },
      payload: JSON.stringify(buildPayload_(recap)),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    Logger.log(date + ': HTTP ' + code + ' ' + res.getContentText().slice(0, 300));
    if (code !== 200) throw new Error('Ingest failed for ' + date + ': HTTP ' + code);
    seen[msg.getId()] = date;
    props.setProperty('seenMessageIds', JSON.stringify(seen));
  });
}

function _alertOnce(msg, err, props, seen) {
  seen[msg.getId()] = 'error';
  props.setProperty('seenMessageIds', JSON.stringify(seen));
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    'Whatnot recap NOT loaded: ' + msg.getSubject(),
    'The recap feeder could not read this email, so nothing was posted for it.\n\n' +
    'Reason: ' + err.message + '\n\nFix the cause, then run backfill() from the script editor.');
}

// ─── PARSING (pure: tested by scripts/test-whatnot-recap-parse.mjs) ──────────

const SUBJECT_RE = /Bargain Lane Live recap\s*[–—-]\s*[A-Za-z]{3}\s+(\d{1,2})\/(\d{1,2}):\s*\$([\d,]+(?:\.\d{1,2})?)\s+on\s+(\d+)\s+shows?/;
const SHOW_RE = /-\s+([A-Za-z][A-Za-z .']*?),\s+(\d{1,2}:\d{2}\s*[AP]M),\s+"([\s\S]*?)":\s+\$([\d,]+(?:\.\d{1,2})?)\s+in\s+sales(?:,\s+([\d,]+)\s+items)?(?:,\s+([\d,]+)\s+shipments)?(?:,\s+([\d,]+)\s+new\s+buyers)?/g;
const MTD_RE = /[A-Za-z]+\s+to\s+date:\s*\$([\d,]+(?:\.\d{1,2})?)\s+from\s+(\d+)\s+shows?(?:\s*\(([^)]*)\))?/;

const _num = s => Number(String(s).replace(/,/g, ''));
const _pad = n => (n < 10 ? '0' : '') + n;

/**
 * → { date, shows: [{location, store, time, title, sales, items, shipments, newBuyers}],
 *     mtd: { BL1: 11871, ... } | null }
 * Returns null when the subject is not a recap. THROWS when it is one but the
 * body does not add up; the caller must then post nothing.
 */
function parseRecap_(subject, body, attachmentNames, sentDate) {
  const sm = SUBJECT_RE.exec(subject || '');
  if (!sm) return null;
  const month = +sm[1], day = +sm[2], subjectTotal = _num(sm[3]), subjectShows = +sm[4];

  // Year: the PDF is named BL-Live-Recap-YYYY-MM-DD.pdf. Without it, the year
  // the email was sent, minus one for a December recap read in January.
  let year = sentDate.getFullYear();
  if (month > sentDate.getMonth() + 1) year -= 1;
  const date = year + '-' + _pad(month) + '-' + _pad(day);
  const att = (attachmentNames || []).map(n => /BL-Live-Recap-(\d{4}-\d{2}-\d{2})\.pdf/i.exec(n)).filter(Boolean)[0];
  if (att && att[1] !== date) throw new Error('subject says ' + date + ' but the PDF is for ' + att[1]);

  // The plain-text body hard-wraps inside a show line; flatten it first.
  const text = String(body || '').replace(/\r/g, '').replace(/\s*\n\s*/g, ' ');
  const shows = [];
  let m;
  SHOW_RE.lastIndex = 0;
  while ((m = SHOW_RE.exec(text))) {
    const location = m[1].trim();
    const store = CONFIG.LOCATION_TO_STORE[location];
    if (!store) throw new Error('unknown location "' + location + '" (add it to LOCATION_TO_STORE)');
    shows.push({
      location, store, time: m[2], title: m[3],
      sales: _num(m[4]),
      items: m[5] ? _num(m[5]) : null, shipments: m[6] ? _num(m[6]) : null, newBuyers: m[7] ? _num(m[7]) : null,
    });
  }

  const sum = shows.reduce((t, s) => t + s.sales, 0);
  if (shows.length !== subjectShows || Math.abs(sum - subjectTotal) >= 0.01) {
    throw new Error('read ' + shows.length + ' shows totalling $' + sum +
      ' but the subject says ' + subjectShows + ' shows, $' + subjectTotal);
  }

  let mtd = null;
  const mm = MTD_RE.exec(text);
  if (mm) {
    mtd = {};
    Object.keys(CONFIG.LOCATION_TO_STORE).forEach(loc => { mtd[CONFIG.LOCATION_TO_STORE[loc]] = 0; });
    (mm[3] || '').split(/,\s*(?=[A-Za-z])/).forEach(part => {
      const pm = /^\s*([A-Za-z][A-Za-z .']*?)\s+\$([\d,]+(?:\.\d{1,2})?)\s*$/.exec(part);
      if (!pm) return;
      const store = CONFIG.LOCATION_TO_STORE[pm[1].trim()];
      if (!store) throw new Error('unknown location "' + pm[1].trim() + '" in the month-to-date line');
      mtd[store] = _num(pm[2]);
    });
  }
  return { date, shows, mtd };
}

/** One row per known store (a store with no shows gets $0, so the day is
 *  recorded as reported rather than missing). */
function buildPayload_(recap) {
  const rows = Object.keys(CONFIG.LOCATION_TO_STORE).map(loc => {
    const store = CONFIG.LOCATION_TO_STORE[loc];
    const mine = recap.shows.filter(s => s.store === store);
    const add = k => mine.reduce((t, s) => t + (s[k] || 0), 0);
    return {
      store, date: recap.date,
      total: Math.round(add('sales') * 100) / 100,
      count: mine.length,
      meta: { items: add('items'), shipments: add('shipments'), new_buyers: add('newBuyers') },
    };
  });
  const payload = { channel: CONFIG.CHANNEL, source_file: 'Bargain Lane Live recap ' + recap.date, rows };
  if (recap.mtd) payload.reconcile = { through: recap.date, totals: recap.mtd };
  return payload;
}
