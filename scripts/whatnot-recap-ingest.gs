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
 *   4. Run `preview` and check its log (View → Logs): one line per day per store.
   5. Run `backfill` once to load every recap already in the inbox.
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

/** Recaps from the last few days, unless the same or a newer copy of that
 *  day's recap was already posted. */
function runDaily() {
  _process(_query() + ' newer_than:4d', 'daily');
}

/** Every recap in the inbox, oldest first, re-posting days already posted.
 *  Safe to re-run: the endpoint upserts on (channel, store, date).
 *  Run preview() first: this WRITES live sales for every day it finds. */
function backfill() {
  _process(_query(), 'backfill');
}

/** Read every recap in the inbox and LOG what backfill() would post, per day
 *  and store. Posts and records nothing. */
function preview() {
  _process(_query(), 'preview');
}

function _query() { return 'from:' + CONFIG.SENDER + ' subject:"' + CONFIG.SUBJECT + '"'; }

// ─── WORK ────────────────────────────────────────────────────────────────────

// Bookkeeping lives in two small script properties (Apps Script caps one at
// 9 KB). postedRecaps: recap date -> sent time of the copy posted for it, so a
// corrected re-send (newer) is posted and a late copy of the original (older)
// is not. alertedMessages: message id -> when we emailed about it. Both keep
// only the last RETAIN_DAYS.
const RETAIN_DAYS = 60;

function _process(query, mode) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('SNAPSHOT_SECRET');
  if (mode !== 'preview' && !secret) throw new Error('Set the SNAPSHOT_SECRET script property first (Project Settings → Script Properties).');
  const posted = JSON.parse(props.getProperty('postedRecaps') || '{}');
  const alerted = JSON.parse(props.getProperty('alertedMessages') || '{}');

  // Newest copy per recap date (an original and its forward say the same thing).
  const byDate = {};
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    threads.forEach(th => th.getMessages().forEach(m => {
      if (m.getFrom().toLowerCase().indexOf(CONFIG.SENDER) < 0) return;   // a reply from someone else
      const subject = m.getSubject();
      if (/^\s*re:/i.test(subject)) return;                              // a reply, not a recap
      let recap;
      try {
        recap = parseRecap_(subject, m.getPlainBody(), m.getAttachments().map(a => a.getName()), m.getDate());
        if (!recap) throw new Error('the subject line is not in the expected format');
      } catch (e) {
        if (mode === 'preview') Logger.log('NOT LOADABLE  ' + subject + '  (' + e.message + ')');
        else if (!alerted[m.getId()]) { _alert(subject, e); alerted[m.getId()] = Date.now(); }
        return;
      }
      const sent = m.getDate().getTime();
      if (!byDate[recap.date] || sent > byDate[recap.date].sent) byDate[recap.date] = { recap, sent };
    }));
    if (threads.length < 100) break;
  }

  // Oldest first, so each recap's month-to-date check sees every earlier day.
  Object.keys(byDate).sort().forEach(date => {
    const { recap, sent } = byDate[date];
    const payload = buildPayload_(recap);
    if (mode === 'preview') {
      Logger.log(date + '  ' + payload.rows.map(r => r.store + ' $' + r.total + ' (' + r.count + ' shows)').join('  '));
      return;
    }
    if (mode === 'daily' && posted[date] >= sent) return;
    const res = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Snapshot-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    Logger.log(date + ': HTTP ' + code + ' ' + res.getContentText().slice(0, 300));
    if (code !== 200) throw new Error('Ingest failed for ' + date + ': HTTP ' + code);
    posted[date] = sent;
    props.setProperty('postedRecaps', JSON.stringify(_recent(posted, k => k)));
  });
  if (mode !== 'preview') props.setProperty('alertedMessages', JSON.stringify(_recent(alerted, (k, v) => new Date(v).toISOString())));
}

// Keep the entries within RETAIN_DAYS of the newest one (deterministic: never
// relative to today, so a long-idle script does not wipe its own memory).
function _recent(map, dayOf) {
  const keys = Object.keys(map);
  const days = keys.map(k => String(dayOf(k, map[k])).slice(0, 10)).sort();
  if (!days.length) return map;
  const cutoff = new Date(new Date(days[days.length - 1] + 'T12:00:00Z').getTime() - RETAIN_DAYS * 864e5).toISOString().slice(0, 10);
  const out = {};
  keys.forEach(k => { if (String(dayOf(k, map[k])).slice(0, 10) >= cutoff) out[k] = map[k]; });
  return out;
}

function _alert(subject, err) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    'Whatnot recap NOT loaded: ' + subject,
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

  // Show lines carry a time but no date. One day's shows run in time order, so
  // a time that goes backwards means this email spans more than one day (a
  // month-to-date email in the daily layout), and posting it would book every
  // show onto the subject's date.
  const minutes = shows.map(s => { const t = /(\d{1,2}):(\d{2})\s*([AP])M/.exec(s.time); return (+t[1] % 12 + (t[3] === 'P' ? 12 : 0)) * 60 + +t[2]; });
  for (let i = 1; i < minutes.length; i++) {
    if (minutes[i] < minutes[i - 1]) throw new Error('show times are not in time order (' + shows[i - 1].time + ' then ' + shows[i].time + '): this looks like more than one day');
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
