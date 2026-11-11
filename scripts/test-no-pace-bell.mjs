// The header notifications bell is gone (Brian, 2026-11-11): no more "<store>
// pacing 77% of day budget", "day budget reached" or "<store> is offline" items.
// He wants the space for something else later, so this pins the removal: the
// bell must not come back by a revert or a merge from an old branch.
//
// It also guards the neighbours of the cut. The bell sat between the Refresh
// button and the date-range chip, and its JS block ended right where
// renderDashboard() begins, so a sloppy removal would take one of them with it.
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.argv[2] || '.';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

console.log('the bell and its alerts are gone:');
ok('no bell in the header', !/id="notif-bell-(wrap|trigger|panel|list|badge)"/.test(html));
ok('no pace alert text', !/pacing <b[^>]*>\$\{pct\}%<\/b> of day budget/.test(html));
ok('no "day budget reached" milestone', !/day budget reached/.test(html));
ok('nothing builds the alert list', !/function computeNotifications\b/.test(html));
ok('nothing renders it', !/\brenderNotifications\b/.test(html));
ok('no bell CSS left behind', !/notif-bell-trigger|@keyframes notif-(pulse|shake)/.test(html));
ok('no empty attention strip left behind', !/id="dashboard-attn-strip"/.test(html));

console.log('\nwhat sat next to it is still there:');
ok('Refresh button', /id="dash-refresh-btn"/.test(html));
ok('date-range chip', /id="day-chip-trigger"[^>]*onclick="toggleDayPanel\(event\)"/.test(html));
ok('store cards', /<div id="store-cards"/.test(html));
ok('renderDashboard still defined', /\n  function renderDashboard\(\) \{\n    if \(!dateRange\.from\) return;/.test(html));
ok('renderDashboard still draws the cards', /\n    renderCards\(metrics\);\n  \}\n/.test(html));
// The Settings → Notifications push preferences are a different feature and stay.
ok('push notification settings untouched', /function updateNotifPrefs\(\)/.test(html) && /function toggleNotifSettings\(\)/.test(html));

console.log(fail ? `\n${fail} FAILED` : `\nall ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
