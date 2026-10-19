// The online-auction feeder (scripts/auction-drive-ingest.gs), loaded unmodified
// in a VM with fake Apps Script services: its schedule, and its seen-file record.
//
// 2026-10-19: the Executive Summary moved to 5 AM Eastern. The feeder ran at 7 AM,
// 1 PM and 5 PM, so yesterday's online auction would have missed the email every
// day. It now runs every 10 minutes, as the Whatnot feeder does (hour triggers fire
// anywhere in their hour, in the project's time zone).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

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
  DriveApp: {}, PropertiesService: {}, UrlFetchApp: {}, Utilities: {},
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(repo, 'scripts/auction-drive-ingest.gs'), 'utf8'), sb);
vm.runInContext('installTrigger()', sb);
eq(deleted, ['old7', 'old13', 'old17'], 'replaces the old 7 AM / 1 PM / 5 PM runDaily triggers, and only those');
eq(made.map(t => [t.fn, t.minutes, t.hour]), [['runDaily', 10, undefined]], 'one trigger: runDaily every 10 minutes, no fixed hour');

// ── The seen-file record stays bounded ──────────────────────────────────────
// seenFileIds is one Script Property (9 KB cap) holding fileId → when seen. It
// only grew, so at ~one zip a day it would fill around late November 2026; after
// that _markSeen throws inside runDaily's try, nothing is marked seen again, and
// every new zip is re-unzipped and re-POSTed on every run (144 a day at every 10
// minutes). The export is a rolling 7 days, so a zip older than 60 days never needs
// reading: it is skipped, and its entry is dropped.
{
  const DAY = 864e5, NOW = Date.parse('2026-11-20T12:00:00Z');
  const props = {};
  const old = {};
  for (let i = 0; i < 170; i++) old['old' + String(i).padStart(30, '0')] = NOW - (90 + i) * DAY;   // ~8.7 KB, all >60 days old
  old['recentSeen'] = NOW - 2 * DAY;
  props.seenFileIds = JSON.stringify(old);
  const file = (id, ageDays) => ({ getId: () => id, getName: () => 'Bargain_Lane_Auction_Results_' + id + '.zip', getDateCreated: () => new Date(NOW - ageDays * DAY) });
  const folderFiles = [file('ancientUnseen', 120), file('recentSeen', 2), file('newUnseen', 0.1)];
  const parsed = [];
  const sb2 = {
    ...sb,
    Date: class extends Date { constructor(...a) { if (a.length === 0) super(NOW); else super(...a); } static now() { return NOW; } },
    DriveApp: { getFolderById: () => ({ getFiles: () => { let i = 0; return { hasNext: () => i < folderFiles.length, next: () => folderFiles[i++] }; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large'); props[k] = String(v); },
    }) },
  };
  vm.createContext(sb2);
  vm.runInContext(fs.readFileSync(path.join(repo, 'scripts/auction-drive-ingest.gs'), 'utf8'), sb2);
  sb2._parseAuctionZip = (f) => { parsed.push(f.getId()); return [{ store: 'BL1', date: '2026-11-19', total: 1 }]; };
  sb2._postIngest = () => {};
  vm.runInContext('runDaily()', sb2);
  eq(parsed, ['newUnseen'], 'reads only the new zip: not one already seen, nor one older than 60 days');
  const kept = Object.keys(JSON.parse(props.seenFileIds)).sort();
  eq(kept, ['newUnseen', 'recentSeen'], 'marks it seen, and drops entries older than 60 days');
  ok(props.seenFileIds.length < 1000, `the record is small again (${props.seenFileIds.length} bytes)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
